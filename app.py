import os
import csv
import io
import re
from datetime import date, datetime
from flask import Flask, render_template, request, redirect, url_for, flash, send_file, jsonify
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib import colors
import openpyxl
from openpyxl.styles import Font, Alignment, Border, Side

from database import db, init_db, Customer, Disconnection, ReminderLetter, OICOrder, extract_scheme, scheme_name
from i18n import get_translations

app = Flask(__name__)
app.secret_key = 'nwsdb-matara-secret-key-2024'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///nwsdb_matara.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)

LETTERS_DIR = os.path.join(os.path.dirname(__file__), 'letters_output')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), 'reports_output')
STORAGE_DIR = os.path.join(os.path.dirname(__file__), 'storage')

os.makedirs(LETTERS_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)

with app.app_context():
    init_db(app)

STAGE_LABELS = {
    'disconnected': 'stage_disconnected',
    'reconnected': 'stage_reconnected',
    'first_reminder': 'stage_first_reminder',
    'ferrule_hold': 'stage_ferrule_hold',
    'ferrule_approved': 'stage_ferrule_approved',
    'oic_issued': 'stage_oic_issued',
    'second_reminder': 'stage_second_reminder',
    'legal': 'stage_legal',
}

STAGE_ICONS = {
    'disconnected': 'bi-slash-circle',
    'reconnected': 'bi-arrow-repeat',
    'first_reminder': 'bi-envelope',
    'ferrule_hold': 'bi-pause-circle',
    'ferrule_approved': 'bi-check-circle',
    'oic_issued': 'bi-water',
    'second_reminder': 'bi-envelope-open',
    'legal': 'bi-gavel',
}

def _(key):
    """Translate a key -- works both in routes and templates."""
    if not request:
        return key
    lang = request.cookies.get('lang', 'si')
    return get_translations(lang).get(key, key)

@app.context_processor
def inject_translations():
    lang = request.cookies.get('lang', 'si') if request else 'si'
    def _(key):
        return get_translations(lang).get(key, key)
    return dict(_=_, current_lang=lang, t=get_translations(lang),
                stage_labels=STAGE_LABELS, stage_icons=STAGE_ICONS,
                stage_badge=stage_badge, scheme_name=scheme_name)

@app.route('/lang/<code>')
def set_lang(code):
    if code not in ('si', 'en'):
        code = 'si'
    resp = redirect(request.referrer or url_for('index'))
    resp.set_cookie('lang', code, max_age=365*24*3600)
    return resp

def parse_date(val):
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, (int, float)):
        from datetime import timedelta
        base = datetime(1899, 12, 30)
        return (base + timedelta(days=int(val))).date()
    s = str(val).strip()
    for fmt in ['%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d', '%Y/%m/%d']:
        try:
            return datetime.strptime(s, fmt).date()
        except:
            pass
    return None

def fmt_date(d):
    if d:
        return d.strftime('%d/%m/%Y')
    return ''

def fmt_amount(n):
    if n is None:
        return '0.00'
    return f'{n:,.2f}'

@app.template_filter('nl2br')
def nl2br_filter(s):
    if s:
        return s.replace('\n', '<br>')
    return ''

def stage_badge(stage):
    colors_map = {
        'disconnected': 'bg-danger',
        'reconnected': 'bg-success',
        'first_reminder': 'bg-info text-dark',
        'ferrule_hold': 'bg-warning text-dark',
        'ferrule_approved': 'bg-primary',
        'oic_issued': 'bg-warning text-dark',
        'second_reminder': 'bg-info text-dark',
        'legal': 'bg-danger',
    }
    return colors_map.get(stage, 'bg-secondary')

# ─────────────────────── Dashboard ───────────────────────

@app.route('/')
def index():
    total = Customer.query.count()
    by_stage = {}
    for s in STAGE_LABELS:
        by_stage[s] = Customer.query.filter_by(stage=s).count()
    by_stage['total'] = total

    pending_first = ReminderLetter.query.filter_by(status='pending', letter_type=1).count()
    pending_second = ReminderLetter.query.filter_by(status='pending', letter_type=2).count()
    returned_mail = ReminderLetter.query.filter_by(status='returned').count()
    pending_oic = OICOrder.query.filter_by(status='pending').count()

    recent = Customer.query.order_by(Customer.id.desc()).limit(10).all()

    return render_template('index.html',
        by_stage=by_stage,
        pending_first=pending_first,
        pending_second=pending_second,
        returned_mail=returned_mail,
        pending_oic=pending_oic,
        recent_customers=recent,
        fmt_date=fmt_date)

# ─────────────────────── DCs Customers ───────────────────────

@app.route('/dcs_customers')
def dcs_customers():
    search = request.args.get('search', '')
    stage_filter = request.args.get('stage', '')
    scheme_filter = request.args.get('scheme', '')

    q = Customer.query
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%'),
            Customer.phone.like(f'%{search}%')
        ))
    if stage_filter:
        q = q.filter_by(stage=stage_filter)
    if scheme_filter:
        q = q.filter_by(scheme=scheme_filter)

    lst = q.order_by(Customer.account_no).all()
    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()
    return render_template('dcs_customers.html', customers=lst,
        schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, stage_badge=stage_badge)

@app.route('/dcs_customers/<int:id>')
def dcs_customer_detail(id):
    c = Customer.query.get_or_404(id)
    return render_template('customer_detail.html', customer=c, fmt_date=fmt_date, stage_badge=stage_badge)

# ─────────────────────── Reconnected ───────────────────────

@app.route('/reconnected', methods=['GET', 'POST'])
def reconnected():
    if request.method == 'POST':
        action = request.form.get('action', '')

        if action == 'mark_selected':
            ids = request.form.getlist('customer_ids')
            count = 0
            for cid in ids:
                c = Customer.query.get(int(cid))
                if c and c.stage != 'reconnected':
                    c.stage = 'reconnected'
                    count += 1
            db.session.commit()
            flash(f'{_("Reconnected successfully")}: {count}', 'success')
            return redirect(url_for('reconnected'))

        if action == 'mark_single':
            cid = request.form.get('customer_id')
            c = Customer.query.get(int(cid))
            if c:
                c.stage = 'reconnected'
                db.session.commit()
                flash(_('Reconnected successfully'), 'success')
            return redirect(url_for('reconnected'))

        if action == 'upload_csv':
            if 'file' not in request.files:
                flash('කරුණාකර ගොනුවක් තෝරන්න', 'danger')
                return redirect(request.url)
            file = request.files['file']
            if file.filename == '':
                flash('කරුණාකර ගොනුවක් තෝරන්න', 'danger')
                return redirect(request.url)

            stream = io.StringIO(file.stream.read().decode('utf-8'))
            reader = csv.DictReader(stream)
            count = 0
            for row in reader:
                acc = (row.get('account_no') or row.get('Account No') or row.get('Account No.') or '').strip()
                if not acc:
                    continue
                c = Customer.query.filter_by(account_no=acc).first()
                if c and c.stage != 'reconnected':
                    c.stage = 'reconnected'
                    count += 1
            db.session.commit()
            flash(f'{_("Reconnected successfully")}: {count}', 'success')
            return redirect(url_for('reconnected'))

    # GET - show DCs customers not yet reconnected, plus reconnected list
    search = request.args.get('search', '')
    scheme_filter = request.args.get('scheme', '')

    q = Customer.query.filter(Customer.stage != 'reconnected')
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%'),
            Customer.phone.like(f'%{search}%')
        ))
    if scheme_filter:
        q = q.filter_by(scheme=scheme_filter)

    active = q.order_by(Customer.account_no).all()

    reconnected_list = Customer.query.filter_by(stage='reconnected').order_by(Customer.name).all()

    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()

    return render_template('reconnected.html',
        active=active, reconnected_list=reconnected_list,
        schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, fmt_amount=fmt_amount, stage_badge=stage_badge)

# ─────────────────────── Import (actual Excel format) ───────────────────────

@app.route('/customers/import', methods=['GET', 'POST'])
def import_customers():
    if request.method == 'POST':
        if 'file' not in request.files:
            flash('කරුණාකර ගොනුවක් තෝරන්න', 'danger')
            return redirect(request.url)
        file = request.files['file']
        if file.filename == '':
            flash('කරුණාකර ගොනුවක් තෝරන්න', 'danger')
            return redirect(request.url)

        imported = 0
        errors = 0

        if file.filename.endswith('.xlsx'):
            wb = openpyxl.load_workbook(file)
            ws = wb.active
            for row_num in range(5, ws.max_row + 1):
                try:
                    serial = ws.cell(row=row_num, column=1).value
                    if serial is None:
                        continue
                    account_no = str(ws.cell(row=row_num, column=2).value or '').strip()
                    if not account_no:
                        continue

                    existing = Customer.query.filter_by(account_no=account_no).first()
                    if existing:
                        continue

                    category = str(ws.cell(row=row_num, column=3).value or '').strip()
                    name_addr_raw = str(ws.cell(row=row_num, column=4).value or '')
                    total_amount = float(ws.cell(row=row_num, column=5).value or 0)
                    reading_info = str(ws.cell(row=row_num, column=6).value or '')

                    parts = name_addr_raw.split('\n')
                    name = parts[0].strip() if parts else ''
                    address = '\n'.join(p[3:] if p.startswith('   ') else p for p in parts[1:]).strip() if len(parts) > 1 else ''
                    if not address:
                        address = name_addr_raw

                    read_parts = reading_info.split('\n')
                    last_reading = None
                    last_read_date = None
                    disconn_date = None
                    try:
                        if len(read_parts) > 0 and read_parts[0].strip().isdigit():
                            last_reading = int(read_parts[0].strip())
                        if len(read_parts) > 1:
                            last_read_date = parse_date(read_parts[1].strip())
                        if len(read_parts) > 2:
                            disconn_date = parse_date(read_parts[2].strip())
                    except:
                        pass

                    if not disconn_date:
                        disconn_date = date.today()

                    scheme = extract_scheme(account_no)
                    customer = Customer(
                        account_no=account_no, name=name, address=address,
                        category=category, stage='disconnected', scheme=scheme
                    )
                    db.session.add(customer)
                    db.session.flush()

                    disconnection = Disconnection(
                        customer_id=customer.id, disconnection_date=disconn_date,
                        amount_due=total_amount, last_reading=last_reading,
                        last_read_date=last_read_date, reason='බිල්පත් ගෙවීම පැහැර හැරීම'
                    )
                    db.session.add(disconnection)
                    imported += 1
                except Exception as e:
                    errors += 1

            db.session.commit()
            flash(f'පාරිභෝගිකයන් {imported} දෙනෙකු ආයාත කරන ලදී. දෝෂ: {errors}', 'success')

        elif file.filename.endswith('.csv'):
            stream = io.StringIO(file.stream.read().decode('utf-8'))
            reader = csv.DictReader(stream)
            for row in reader:
                try:
                    account_no = row.get('account_no', '').strip()
                    if not account_no:
                        continue
                    existing = Customer.query.filter_by(account_no=account_no).first()
                    if existing:
                        continue
                    scheme = extract_scheme(account_no)
                    customer = Customer(
                        account_no=account_no, name=row.get('name', '').strip(),
                        address=row.get('address', '').strip(),
                        category=row.get('category', '').strip(),
                        nic=row.get('nic', '').strip(), phone=row.get('phone', '').strip(),
                        zone=row.get('zone', '').strip(), station=row.get('station', '').strip(),
                        station_officer=row.get('station_officer', '').strip(),
                        stage='disconnected', scheme=scheme
                    )
                    db.session.add(customer)
                    db.session.flush()
                    disconnection = Disconnection(
                        customer_id=customer.id,
                        disconnection_date=parse_date(row.get('disconnection_date', '')) or date.today(),
                        amount_due=float(row.get('amount_due', 0) or 0),
                        reason=row.get('reason', 'බිල්පත් ගෙවීම පැහැර හැරීම')
                    )
                    db.session.add(disconnection)
                    imported += 1
                except:
                    errors += 1
            db.session.commit()
            flash(f'පාරිභෝගිකයන් {imported} දෙනෙකු ආයාත කරන ලදී. දෝෂ: {errors}', 'success')
        else:
            flash('කරුණාකර .csv හෝ .xlsx ගොනුවක් උඩුගත කරන්න', 'danger')

        return redirect(url_for('dcs_customers'))

    return render_template('import.html')

@app.route('/customers/export')
def export_customers():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'DCs පාරිභෝගිකයන්'

    headers = ['ගිණුම් අංකය', 'නම', 'ලිපිනය', 'වර්ගය', 'හිඟ මුදල', 'කලාපය', 'ජලසම්පාදන ක්‍රමය', 'අදියර']
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal='center')

    for idx, c in enumerate(Customer.query.all(), 2):
        ws.cell(row=idx, column=1, value=c.account_no)
        ws.cell(row=idx, column=2, value=c.name)
        ws.cell(row=idx, column=3, value=c.address)
        ws.cell(row=idx, column=4, value=c.category)
        amount = sum(d.amount_due for d in c.disconnections)
        ws.cell(row=idx, column=5, value=amount)
        ws.cell(row=idx, column=6, value=c.zone or '')
        ws.cell(row=idx, column=7, value=c.scheme or '')
        ws.cell(row=idx, column=8, value=c.stage or '')

    for col_letter, w in zip(['A','B','C','D','E','F','G','H'], [15,30,40,20,15,15,15,15]):
        ws.column_dimensions[col_letter].width = w

    filename = f'DCs_පාරිභෝගිකයන්_{date.today().isoformat()}.xlsx'
    filepath = os.path.join(REPORTS_DIR, filename)
    wb.save(filepath)
    return send_file(filepath, as_attachment=True, download_name=filename)

# ─────────────────────── First Reminders (letter_type=1) ───────────────────────

@app.route('/first_reminders')
def first_reminders():
    search = request.args.get('search', '')
    scheme_filter = request.args.get('scheme', '')
    status_filter = request.args.get('status', '')

    q = ReminderLetter.query.filter_by(letter_type=1).join(Customer)
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%')
        ))
    if scheme_filter:
        q = q.filter(Customer.scheme == scheme_filter)
    if status_filter:
        q = q.filter(ReminderLetter.status == status_filter)
    letters_list = q.order_by(ReminderLetter.issue_date.desc()).all()

    stats = {
        'total': ReminderLetter.query.filter_by(letter_type=1).count(),
        'pending': ReminderLetter.query.filter_by(letter_type=1, status='pending').count(),
        'sent': ReminderLetter.query.filter_by(letter_type=1, status='sent').count(),
        'returned': ReminderLetter.query.filter_by(letter_type=1, status='returned').count(),
        'delivered': ReminderLetter.query.filter_by(letter_type=1, status='delivered').count(),
    }

    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()

    return render_template('first_reminders.html',
        letters=letters_list, stats=stats, schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, fmt_amount=fmt_amount)

@app.route('/first_reminders/generate')
def generate_first_reminders():
    customers = Customer.query.filter(Customer.stage.in_(['disconnected', 'first_reminder'])).all()
    count = 0
    for c in customers:
        existing = ReminderLetter.query.filter_by(customer_id=c.id, letter_type=1).first()
        if existing:
            continue
        letter = ReminderLetter(customer_id=c.id, letter_type=1,
            issue_date=date.today(), status='pending')
        db.session.add(letter)
        if c.stage == 'disconnected':
            c.stage = 'first_reminder'
        count += 1
    db.session.commit()
    flash(f'පළමු සිහිකැඳවීම් ලිපි {count} ක් ජනනය කරන ලදී', 'success')
    return redirect(url_for('first_reminders'))

@app.route('/first_reminders/send/<int:letter_id>', methods=['POST'])
def mark_first_reminder_sent(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    letter.status = 'sent'
    letter.sent_date = date.today()
    db.session.commit()
    flash('ලිපිය යවන ලදී ලෙස සලකුණු කරන ලදී', 'success')
    return redirect(url_for('first_reminders'))

@app.route('/first_reminders/return/<int:letter_id>', methods=['POST'])
def mark_first_reminder_returned(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    letter.status = 'returned'
    letter.returned_date = date.today()
    letter.return_reason = request.form.get('return_reason', '')
    db.session.commit()
    flash('ලිපිය ආපසු හරවා එවන ලදී', 'success')
    return redirect(url_for('first_reminders'))

@app.route('/first_reminders/deliver/<int:letter_id>', methods=['POST'])
def mark_first_reminder_delivered(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    letter.status = 'delivered'
    db.session.commit()
    flash('ලිපිය ලබා දුන් බව සලකුණු කරන ලදී', 'success')
    return redirect(url_for('first_reminders'))

@app.route('/first_reminders/pdf/<int:letter_id>')
def download_first_reminder_pdf(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    c = letter.customer

    filename = f'First_Reminder_{c.account_no.replace("/","_")}.pdf'
    filepath = os.path.join(LETTERS_DIR, filename)

    doc = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    doc.setFont('Helvetica-Bold', 14)
    doc.drawCentredString(w/2, h - 35, 'National Water Supply & Drainage Board')
    doc.setFont('Helvetica', 11)
    doc.drawCentredString(w/2, h - 50, 'Matara Regional Office')
    doc.line(50, h - 57, w - 50, h - 57)
    doc.setFont('Helvetica-Bold', 13)
    doc.drawCentredString(w/2, h - 75, 'First Reminder Letter before Legal Action')

    y = h - 100
    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, f'Rev./Mr./Mrs./Ms. {c.name}')
    y -= 18
    for addr_line in c.address.split('\n'):
        doc.drawString(50, y, addr_line.strip())
        y -= 14
    y -= 10

    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Disconnection of Water Supply Due to Non Settlement of Outstanding')
    y -= 14
    doc.drawString(50, y, 'Water Bills')
    y -= 18
    doc.drawString(50, y, f'Account No. : {c.account_no}')
    y -= 22

    doc.setFont('Helvetica', 11)
    disc = c.disconnections[0] if c.disconnections else None
    disc_date_str = fmt_date(disc.disconnection_date) if disc and disc.disconnection_date else ''
    amount_str = fmt_amount(disc.amount_due) if disc else '0.00'

    def draw_wrap(text, x, y, max_w=460):
        words = text.split(' ')
        line = ''
        for word in words:
            test = f'{line} {word}'.strip()
            if doc.stringWidth(test, 'Helvetica', 11) > max_w:
                doc.drawString(x, y, line)
                y -= 16
                line = word
            else:
                line = test
        if line:
            doc.drawString(x, y, line)
            y -= 16
        return y

    body1 = (f'The water connection provided by the Water Supply Scheme of Water Board '
             f'under Account No. {c.account_no} Board of premises at '
             f'{c.address.replace(chr(10), ", ")} belonging to you has been '
             f'disconnected on {disc_date_str} due to non-settlement of water bills.')
    y = draw_wrap(body1, 50, y)
    y -= 6

    y = draw_wrap('Therefore you are kindly informed to get that disconnected water supply '
                  'reconnected by way of making payments in the following manner.', 50, y)
    y -= 6

    doc.drawString(50, y, '1. The outstanding amount including arrears:')
    doc.setFont('Helvetica-Bold', 11)
    doc.drawRightString(w - 50, y, f'Rs. {amount_str}')
    y -= 16
    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, '2. Reconnection charges:')
    doc.setFont('Helvetica-Bold', 11)
    doc.drawRightString(w - 50, y, 'Rs. 1,180.00')
    y -= 16
    doc.setFont('Helvetica-Bold', 11)
    total = (disc.amount_due if disc else 0) + 1180.0
    doc.drawString(50, y, '3. Total Amount:')
    doc.drawRightString(w - 50, y, f'Rs. {fmt_amount(total)}')
    y -= 22

    doc.setFont('Helvetica', 11)
    y = draw_wrap('If any action is not taken to get the disconnected water supply reconnected '
                  'with the payment of above mentioned charges within 14 days, your water supply '
                  'will be disconnected from the main line. If such disconnection is made from '
                  'the main line, you are required to pay ferule reconnection charge in addition '
                  'to the above amount mentioned 2. and further you have to pay charges to '
                  'relevant institution for repairing the road, in case where it is necessary '
                  'to damage the road in the reconnection.', 50, y)
    y -= 6

    y = draw_wrap('Further you are hereby informed that the relevant file will be sent to the '
                  'Legal Division of the Head Office in order to take legal action as per '
                  'section 87 of National Water Supply and Drainage Board Act No. 02 1974 to '
                  'recover outstanding amount, if the aforesaid bill in arrears is not settled '
                  'within 14 days.', 50, y)
    y -= 20

    doc.drawString(50, y, '..............................................')
    y -= 16
    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Senior Commercial Officer')
    y -= 14
    doc.setFont('Helvetica', 10)
    doc.drawString(50, y, 'National Water Supply & Drainage Board')
    y -= 14
    doc.drawString(50, y, 'Matara Regional Office')

    doc.save()
    return send_file(filepath, as_attachment=True, download_name=filename)

@app.route('/first_reminders/print-pending')
def print_pending_first_reminders():
    letters = ReminderLetter.query.filter_by(status='pending', letter_type=1).all()
    if not letters:
        flash('මුද්‍රණය කිරීමට ලිපි නොමැත', 'warning')
        return redirect(url_for('first_reminders'))

    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    filename = f'First_Reminders_Batch_{date.today().isoformat()}.pdf'
    filepath = os.path.join(LETTERS_DIR, filename)

    doc = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    for idx, letter in enumerate(letters):
        if idx > 0:
            doc.showPage()
        c = letter.customer
        disc = c.disconnections[0] if c.disconnections else None
        disc_date_str = fmt_date(disc.disconnection_date) if disc else ''
        amount_str = fmt_amount(disc.amount_due) if disc else '0.00'

        def dw(text, x, y, max_w=460):
            words = text.split(' ')
            line = ''
            for word in words:
                test = f'{line} {word}'.strip()
                if doc.stringWidth(test, 'Helvetica', 11) > max_w:
                    doc.drawString(x, y, line)
                    y -= 16
                    line = word
                else:
                    line = test
            if line:
                doc.drawString(x, y, line)
                y -= 16
            return y

        doc.setFont('Helvetica-Bold', 14)
        doc.drawCentredString(w/2, h - 35, 'National Water Supply & Drainage Board')
        doc.setFont('Helvetica', 11)
        doc.drawCentredString(w/2, h - 50, 'Matara Regional Office')
        doc.line(50, h - 57, w - 50, h - 57)
        doc.setFont('Helvetica-Bold', 13)
        doc.drawCentredString(w/2, h - 75, 'First Reminder Letter before Legal Action')

        y = h - 100
        doc.setFont('Helvetica', 11)
        doc.drawString(50, y, f'Rev./Mr./Mrs./Ms. {c.name}')
        y -= 16
        for addr_line in c.address.split('\n'):
            doc.drawString(50, y, addr_line.strip())
            y -= 14
        y -= 10

        doc.setFont('Helvetica-Bold', 11)
        doc.drawString(50, y, 'Disconnection of Water Supply Due to Non Settlement of Outstanding')
        y -= 14
        doc.drawString(50, y, 'Water Bills')
        y -= 18
        doc.drawString(50, y, f'Account No. : {c.account_no}')
        y -= 22

        doc.setFont('Helvetica', 11)
        body1 = (f'The water connection provided by the Water Supply Scheme of Water Board '
                 f'under Account No. {c.account_no} Board of premises at '
                 f'{c.address.replace(chr(10), ", ")} belonging to you has been '
                 f'disconnected on {disc_date_str} due to non-settlement of water bills.')
        y = dw(body1, 50, y)
        y -= 6

        y = dw('Therefore you are kindly informed to get that disconnected water supply '
               'reconnected by way of making payments in the following manner.', 50, y)
        y -= 6

        total = (disc.amount_due if disc else 0) + 1180.0

        doc.drawString(50, y, '1. The outstanding amount including arrears:')
        doc.drawRightString(w - 80, y, f'Rs. {amount_str}')
        y -= 16
        doc.drawString(50, y, '2. Reconnection charges:')
        doc.drawRightString(w - 80, y, 'Rs. 1,180.00')
        y -= 16
        doc.setFont('Helvetica-Bold', 11)
        doc.drawString(50, y, '3. Total Amount:')
        doc.drawRightString(w - 80, y, f'Rs. {fmt_amount(total)}')
        y -= 22

        doc.setFont('Helvetica', 11)
        y = dw('If any action is not taken to get the disconnected water supply reconnected '
               'with the payment of above mentioned charges within 14 days, your water supply '
               'will be disconnected from the main line. If such disconnection is made from '
               'the main line, you are required to pay ferule reconnection charge in addition '
               'to the above amount mentioned 2. and further you have to pay charges to '
               'relevant institution for repairing the road, in case where it is necessary '
               'to damage the road in the reconnection.', 50, y)
        y -= 6

        y = dw('Further you are hereby informed that the relevant file will be sent to the '
               'Legal Division of the Head Office in order to take legal action as per '
               'section 87 of National Water Supply and Drainage Board Act No. 02 1974 to '
               'recover outstanding amount, if the aforesaid bill in arrears is not settled '
               'within 14 days.', 50, y)
        y -= 20

        doc.drawString(50, y, '..............................................')
        y -= 16
        doc.setFont('Helvetica-Bold', 11)
        doc.drawString(50, y, 'Senior Commercial Officer')
        y -= 14
        doc.setFont('Helvetica', 10)
        doc.drawString(50, y, 'National Water Supply & Drainage Board')
        y -= 14
        doc.drawString(50, y, 'Matara Regional Office')

    doc.save()

    for letter in letters:
        letter.status = 'sent'
        letter.sent_date = date.today()
    db.session.commit()

    flash(f'ලිපි {len(letters)} ක් මුද්‍රණය කර යවන ලදී ලෙස සලකුණු කරන ලදී', 'success')
    return send_file(filepath, as_attachment=True, download_name=filename)

# ─────────────────────── Ferrule Processing ───────────────────────

@app.route('/ferrule_processing', methods=['GET', 'POST'])
def ferrule_processing():
    if request.method == 'POST':
        action = request.form.get('action')
        cid = request.form.get('customer_id')
        note = request.form.get('note', '')

        c = Customer.query.get(int(cid))
        if not c:
            flash('පාරිභෝගිකයා හමු නොවීය', 'danger')
            return redirect(url_for('ferrule_processing'))

        if action == 'approve_oic':
            c.stage = 'ferrule_approved'
            c.stage_note = note or 'Approved for OIC'
            flash(f'{c.account_no} - OIC සඳහා අනුමත කරන ලදී', 'success')
        elif action == 'hold_payment':
            c.stage = 'ferrule_hold'
            c.stage_note = note or 'Payment plan'
            flash(f'{c.account_no} - ගෙවීම් සැලැස්ම නිසා රඳවා ඇත', 'info')
        elif action == 'hold_complaint':
            c.stage = 'ferrule_hold'
            c.stage_note = note or 'Complaint'
            flash(f'{c.account_no} - පැමිණිල්ල නිසා රඳවා ඇත', 'info')
        elif action == 'hold_special':
            c.stage = 'ferrule_hold'
            c.stage_note = note or 'Special reason'
            flash(f'{c.account_no} - විශේෂ හේතුව නිසා රඳවා ඇත', 'info')
        elif action == 'mark_reconnected':
            c.stage = 'reconnected'
            c.stage_note = note or ''
            flash(f'{c.account_no} - නැවත සම්බන්ධ කරන ලදී', 'success')

        db.session.commit()
        return redirect(url_for('ferrule_processing'))

    # GET - show customers who have first_reminder delivered/sent but not yet ferrule-processed
    search = request.args.get('search', '')
    scheme_filter = request.args.get('scheme', '')

    q = Customer.query.filter(Customer.stage.in_(['first_reminder', 'ferrule_hold']))
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%')
        ))
    if scheme_filter:
        q = q.filter_by(scheme=scheme_filter)

    customers = q.order_by(Customer.account_no).all()

    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()

    return render_template('ferrule_processing.html',
        customers=customers,
        schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, fmt_amount=fmt_amount, stage_badge=stage_badge)

# ─────────────────────── OIC Orders ───────────────────────

@app.route('/oic')
def oic_list():
    search = request.args.get('search', '')
    status_filter = request.args.get('status', '')
    scheme_filter = request.args.get('scheme', '')

    q = OICOrder.query.join(Customer)
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%')
        ))
    if status_filter:
        q = q.filter(OICOrder.status == status_filter)
    if scheme_filter:
        q = q.filter(Customer.scheme == scheme_filter)

    orders = q.order_by(OICOrder.order_date.desc()).all()

    stats = {
        'total': OICOrder.query.count(),
        'pending': OICOrder.query.filter_by(status='pending').count(),
        'completed': OICOrder.query.filter_by(status='completed').count(),
    }

    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()

    return render_template('oic_orders.html', orders=orders, stats=stats,
        schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, fmt_amount=fmt_amount)

@app.route('/oic/generate')
def generate_oic_orders():
    customers = Customer.query.filter_by(stage='ferrule_approved').all()
    count = 0
    for c in customers:
        existing = OICOrder.query.filter_by(customer_id=c.id, status='pending').first()
        if existing:
            continue
        disc = c.disconnections[0] if c.disconnections else None
        amount = disc.amount_due if disc else 0
        order = OICOrder(
            customer_id=c.id, order_date=date.today(),
            station_officer=c.station_officer or '',
            amount_outstanding=amount, reconnection_charge=3540.00,
            total_amount=amount + 3540.00,
        )
        db.session.add(order)
        c.stage = 'oic_issued'
        count += 1
    db.session.commit()
    flash(f'OIC නියෝග {count} ක් ජනනය කරන ලදී', 'success')
    return redirect(url_for('oic_list'))

@app.route('/oic/generate-scheme/<scheme>')
def generate_oic_scheme(scheme):
    customers = Customer.query.filter_by(stage='ferrule_approved', scheme=scheme).all()
    count = 0
    for c in customers:
        existing = OICOrder.query.filter_by(customer_id=c.id, status='pending').first()
        if existing:
            continue
        disc = c.disconnections[0] if c.disconnections else None
        amount = disc.amount_due if disc else 0
        order = OICOrder(
            customer_id=c.id, order_date=date.today(),
            station_officer=c.station_officer or '',
            amount_outstanding=amount, reconnection_charge=3540.00,
            total_amount=amount + 3540.00,
        )
        db.session.add(order)
        c.stage = 'oic_issued'
        count += 1
    db.session.commit()
    flash(f'{scheme} සඳහා OIC නියෝග {count} ක් ජනනය කරන ලදී', 'success')
    return redirect(url_for('oic_list'))

@app.route('/oic/pdf/<int:order_id>')
def download_oic_pdf(order_id):
    order = OICOrder.query.get_or_404(order_id)
    c = order.customer

    filename = f'OIC_Order_{c.account_no.replace("/","_")}.pdf'
    filepath = os.path.join(LETTERS_DIR, filename)

    doc = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    # Page 1: Order Form
    doc.setFont('Helvetica-Bold', 13)
    doc.drawCentredString(w/2, h - 30, 'National Water Supply & Drainage Board')
    doc.setFont('Helvetica', 11)
    doc.drawCentredString(w/2, h - 45, 'Matara Regional Office - Commercial Division')
    doc.line(50, h - 52, w - 50, h - 52)

    doc.setFont('Helvetica-Bold', 12)
    doc.drawCentredString(w/2, h - 68, 'Ferrule Disconnection Order')
    doc.line(50, h - 72, w - 50, h - 72)

    y = h - 90
    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, 'To:')
    y -= 18
    doc.drawString(60, y, 'Station Officer in Charge')
    y -= 16
    doc.drawString(60, y, f'{c.station or "Matara WSS"}')
    y -= 24

    doc.drawString(50, y, f'Date: {fmt_date(order.order_date)}')
    y -= 18
    doc.drawString(50, y, f'Order Ref: OIC/{order.id:05d}/{order.order_date.year}')
    y -= 24

    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Re: Ferrule Disconnection Due to Non-Payment of Water Bills')
    y -= 22

    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Customer Details:')
    y -= 18

    doc.setFont('Helvetica', 11)
    detail_lines = [
        f'Account No      : {c.account_no}',
        f'Customer Name   : {c.name}',
        f'Category        : {c.category or "N/A"}',
        f'Address         : {c.address.replace(chr(10), ", ")}',
    ]
    for line in detail_lines:
        doc.drawString(60, y, line)
        y -= 16

    y -= 10
    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Amount Details:')
    y -= 18

    doc.setFont('Helvetica', 11)
    doc.drawString(60, y, f'Outstanding Amount      : Rs. {fmt_amount(order.amount_outstanding)}')
    y -= 16
    doc.drawString(60, y, f'Reconnection Charge     : Rs. {fmt_amount(order.reconnection_charge)}')
    y -= 16
    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(60, y, f'Total Amount            : Rs. {fmt_amount(order.total_amount)}')
    y -= 24

    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, 'You are hereby instructed to disconnect the above customer\'s water')
    y -= 16
    doc.drawString(50, y, 'supply from the main (ferrule) line immediately and report the')
    y -= 16
    doc.drawString(50, y, 'completion of this order within 3 working days.')
    y -= 30

    doc.drawString(50, y, '..............................................')
    y -= 16
    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Senior Commercial Officer')
    y -= 14
    doc.setFont('Helvetica', 10)
    doc.drawString(50, y, 'National Water Supply & Drainage Board')
    y -= 14
    doc.drawString(50, y, 'Matara Regional Office')

    # Page 2: Acknowledgment
    doc.showPage()
    doc.setFont('Helvetica-Bold', 13)
    doc.drawCentredString(w/2, h - 30, 'National Water Supply & Drainage Board')
    doc.drawCentredString(w/2, h - 45, 'Matara Regional Office - Commercial Division')
    doc.line(50, h - 52, w - 50, h - 52)

    doc.setFont('Helvetica-Bold', 12)
    doc.drawCentredString(w/2, h - 68, 'Ferrule Disconnection Order - Acknowledgment')
    doc.line(50, h - 72, w - 50, h - 72)

    y = h - 95
    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, f'Order Ref: OIC/{order.id:05d}/{order.order_date.year}')
    y -= 18
    doc.drawString(50, y, f'Customer: {c.name} ({c.account_no})')
    y -= 24

    doc.drawString(50, y, 'I acknowledge receipt of the above disconnection order and confirm')
    y -= 16
    doc.drawString(50, y, 'that the disconnection has been carried out.')
    y -= 40

    doc.drawString(50, y, 'Date of Disconnection: .......................................')
    y -= 30
    doc.drawString(50, y, 'OIC Signature: ..............................................')
    y -= 30
    doc.drawString(50, y, 'OIC Name: ...................................................')
    y -= 30
    doc.drawString(50, y, 'Remarks: ....................................................')

    doc.save()
    return send_file(filepath, as_attachment=True, download_name=filename)

@app.route('/oic/complete/<int:order_id>', methods=['POST'])
def complete_oic(order_id):
    order = OICOrder.query.get_or_404(order_id)
    order.status = 'completed'
    order.completed_date = date.today()
    db.session.commit()
    flash('OIC නියෝගය සම්පූර්ණ කරන ලදී', 'success')
    return redirect(url_for('oic_list'))

# ─────────────────────── Second Reminders (letter_type=2) ───────────────────────

@app.route('/second_reminders')
def second_reminders():
    search = request.args.get('search', '')
    scheme_filter = request.args.get('scheme', '')
    status_filter = request.args.get('status', '')

    q = ReminderLetter.query.filter_by(letter_type=2).join(Customer)
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%')
        ))
    if scheme_filter:
        q = q.filter(Customer.scheme == scheme_filter)
    if status_filter:
        q = q.filter(ReminderLetter.status == status_filter)
    letters_list = q.order_by(ReminderLetter.issue_date.desc()).all()

    stats = {
        'total': ReminderLetter.query.filter_by(letter_type=2).count(),
        'pending': ReminderLetter.query.filter_by(letter_type=2, status='pending').count(),
        'sent': ReminderLetter.query.filter_by(letter_type=2, status='sent').count(),
        'returned': ReminderLetter.query.filter_by(letter_type=2, status='returned').count(),
        'delivered': ReminderLetter.query.filter_by(letter_type=2, status='delivered').count(),
    }

    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()

    return render_template('second_reminders.html',
        letters=letters_list, stats=stats, schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, fmt_amount=fmt_amount)

@app.route('/second_reminders/generate')
def generate_second_reminders():
    # Customers who are in oic_issued or second_reminder stage
    customers = Customer.query.filter(Customer.stage.in_(['oic_issued', 'second_reminder'])).all()
    count = 0
    for c in customers:
        existing = ReminderLetter.query.filter_by(customer_id=c.id, letter_type=2).first()
        if existing:
            continue
        letter = ReminderLetter(customer_id=c.id, letter_type=2,
            issue_date=date.today(), status='pending')
        db.session.add(letter)
        if c.stage == 'oic_issued':
            c.stage = 'second_reminder'
        count += 1
    db.session.commit()
    flash(f'දෙවන සිහිකැඳවීම් ලිපි {count} ක් ජනනය කරන ලදී', 'success')
    return redirect(url_for('second_reminders'))

@app.route('/second_reminders/send/<int:letter_id>', methods=['POST'])
def mark_second_reminder_sent(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    letter.status = 'sent'
    letter.sent_date = date.today()
    db.session.commit()
    flash('ලිපිය යවන ලදී ලෙස සලකුණු කරන ලදී', 'success')
    return redirect(url_for('second_reminders'))

@app.route('/second_reminders/return/<int:letter_id>', methods=['POST'])
def mark_second_reminder_returned(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    letter.status = 'returned'
    letter.returned_date = date.today()
    letter.return_reason = request.form.get('return_reason', '')
    db.session.commit()
    flash('ලිපිය ආපසු හරවා එවන ලදී', 'success')
    return redirect(url_for('second_reminders'))

@app.route('/second_reminders/deliver/<int:letter_id>', methods=['POST'])
def mark_second_reminder_delivered(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    letter.status = 'delivered'
    db.session.commit()
    flash('ලිපිය ලබා දුන් බව සලකුණු කරන ලදී', 'success')
    return redirect(url_for('second_reminders'))

@app.route('/second_reminders/pdf/<int:letter_id>')
def download_second_reminder_pdf(letter_id):
    letter = ReminderLetter.query.get_or_404(letter_id)
    c = letter.customer

    filename = f'Second_Reminder_{c.account_no.replace("/","_")}.pdf'
    filepath = os.path.join(LETTERS_DIR, filename)

    doc = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    doc.setFont('Helvetica-Bold', 14)
    doc.drawCentredString(w/2, h - 35, 'National Water Supply & Drainage Board')
    doc.setFont('Helvetica', 11)
    doc.drawCentredString(w/2, h - 50, 'Matara Regional Office')
    doc.line(50, h - 57, w - 50, h - 57)
    doc.setFont('Helvetica-Bold', 13)
    doc.drawCentredString(w/2, h - 75, 'SECOND REMINDER - Final Warning before Legal Action')

    y = h - 100
    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, f'Rev./Mr./Mrs./Ms. {c.name}')
    y -= 18
    for addr_line in c.address.split('\n'):
        doc.drawString(50, y, addr_line.strip())
        y -= 14
    y -= 10

    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Re: Final Notice - Disconnection of Water Supply & Legal Action')
    y -= 18
    doc.drawString(50, y, f'Account No. : {c.account_no}')
    y -= 22

    doc.setFont('Helvetica', 11)
    disc = c.disconnections[0] if c.disconnections else None
    amount_str = fmt_amount(disc.amount_due) if disc else '0.00'

    def draw_wrap(text, x, y, max_w=460):
        words = text.split(' ')
        line = ''
        for word in words:
            test = f'{line} {word}'.strip()
            if doc.stringWidth(test, 'Helvetica', 11) > max_w:
                doc.drawString(x, y, line)
                y -= 16
                line = word
            else:
                line = test
        if line:
            doc.drawString(x, y, line)
            y -= 16
        return y

    body = (f'Despite previous reminders, the outstanding water bill of Rs. {amount_str} '
            f'under Account No. {c.account_no} remains unpaid. You are hereby given a FINAL '
            f'notice to settle the outstanding amount of Rs. {amount_str} together with '
            f'reconnection charges of Rs. 1,180.00 within 07 days from the date of this letter.')
    y = draw_wrap(body, 50, y)
    y -= 10

    y = draw_wrap('IF YOU FAIL TO COMPLY WITH THIS NOTICE, THE WATER BOARD WILL PROCEED WITH '
                  'LEGAL ACTION UNDER SECTION 87 OF THE NATIONAL WATER SUPPLY AND DRAINAGE BOARD '
                  'ACT NO. 02 OF 1974 TO RECOVER THE OUTSTANDING AMOUNT THROUGH THE MAGISTRATE\'S '
                  'COURT. YOU WILL BE LIABLE FOR ALL LEGAL COSTS INCURRED.', 50, y)
    y -= 10

    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Outstanding Amount     :')
    doc.drawRightString(w - 100, y, f'Rs. {amount_str}')
    y -= 16
    doc.drawString(50, y, 'Reconnection Charges   :')
    doc.drawRightString(w - 100, y, 'Rs. 1,180.00')
    y -= 16
    total = (disc.amount_due if disc else 0) + 1180.0
    doc.drawString(50, y, 'TOTAL DUE              :')
    doc.drawRightString(w - 100, y, f'Rs. {fmt_amount(total)}')
    y -= 30

    doc.setFont('Helvetica', 11)
    doc.drawString(50, y, '..............................................')
    y -= 16
    doc.setFont('Helvetica-Bold', 11)
    doc.drawString(50, y, 'Senior Commercial Officer')
    y -= 14
    doc.setFont('Helvetica', 10)
    doc.drawString(50, y, 'National Water Supply & Drainage Board')
    y -= 14
    doc.drawString(50, y, 'Matara Regional Office')

    doc.save()
    return send_file(filepath, as_attachment=True, download_name=filename)

@app.route('/second_reminders/print-pending')
def print_pending_second_reminders():
    letters = ReminderLetter.query.filter_by(status='pending', letter_type=2).all()
    if not letters:
        flash('මුද්‍රණය කිරීමට ලිපි නොමැත', 'warning')
        return redirect(url_for('second_reminders'))

    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    filename = f'Second_Reminders_Batch_{date.today().isoformat()}.pdf'
    filepath = os.path.join(LETTERS_DIR, filename)

    doc = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    for idx, letter in enumerate(letters):
        if idx > 0:
            doc.showPage()
        c = letter.customer
        disc = c.disconnections[0] if c.disconnections else None
        amount_str = fmt_amount(disc.amount_due) if disc else '0.00'

        def dw(text, x, y, max_w=460):
            words = text.split(' ')
            line = ''
            for word in words:
                test = f'{line} {word}'.strip()
                if doc.stringWidth(test, 'Helvetica', 11) > max_w:
                    doc.drawString(x, y, line)
                    y -= 16
                    line = word
                else:
                    line = test
            if line:
                doc.drawString(x, y, line)
                y -= 16
            return y

        doc.setFont('Helvetica-Bold', 14)
        doc.drawCentredString(w/2, h - 35, 'National Water Supply & Drainage Board')
        doc.setFont('Helvetica', 11)
        doc.drawCentredString(w/2, h - 50, 'Matara Regional Office')
        doc.line(50, h - 57, w - 50, h - 57)
        doc.setFont('Helvetica-Bold', 13)
        doc.drawCentredString(w/2, h - 75, 'SECOND REMINDER - Final Warning before Legal Action')

        y = h - 100
        doc.setFont('Helvetica', 11)
        doc.drawString(50, y, f'Rev./Mr./Mrs./Ms. {c.name}')
        y -= 16
        for addr_line in c.address.split('\n'):
            doc.drawString(50, y, addr_line.strip())
            y -= 14
        y -= 10

        doc.setFont('Helvetica-Bold', 11)
        doc.drawString(50, y, 'Re: Final Notice - Disconnection of Water Supply & Legal Action')
        y -= 18
        doc.drawString(50, y, f'Account No. : {c.account_no}')
        y -= 22

        doc.setFont('Helvetica', 11)
        body = (f'Despite previous reminders, the outstanding water bill of Rs. {amount_str} '
                f'under Account No. {c.account_no} remains unpaid. You are hereby given a FINAL '
                f'notice to settle the outstanding amount of Rs. {amount_str} together with '
                f'reconnection charges of Rs. 1,180.00 within 07 days from the date of this letter.')
        y = dw(body, 50, y)
        y -= 10

        y = dw('IF YOU FAIL TO COMPLY WITH THIS NOTICE, THE WATER BOARD WILL PROCEED WITH '
               'LEGAL ACTION UNDER SECTION 87 OF THE NATIONAL WATER SUPPLY AND DRAINAGE BOARD '
               'ACT NO. 02 OF 1974 TO RECOVER THE OUTSTANDING AMOUNT THROUGH THE MAGISTRATE\'S '
               'COURT. YOU WILL BE LIABLE FOR ALL LEGAL COSTS INCURRED.', 50, y)
        y -= 10

        total = (disc.amount_due if disc else 0) + 1180.0
        doc.setFont('Helvetica-Bold', 11)
        doc.drawString(50, y, 'Outstanding Amount   :')
        doc.drawRightString(w - 100, y, f'Rs. {amount_str}')
        y -= 16
        doc.drawString(50, y, 'Reconnection Charges :')
        doc.drawRightString(w - 100, y, 'Rs. 1,180.00')
        y -= 16
        doc.drawString(50, y, 'TOTAL DUE            :')
        doc.drawRightString(w - 100, y, f'Rs. {fmt_amount(total)}')
        y -= 30

        doc.setFont('Helvetica', 11)
        doc.drawString(50, y, '..............................................')
        y -= 16
        doc.setFont('Helvetica-Bold', 11)
        doc.drawString(50, y, 'Senior Commercial Officer')
        y -= 14
        doc.setFont('Helvetica', 10)
        doc.drawString(50, y, 'National Water Supply & Drainage Board')
        y -= 14
        doc.drawString(50, y, 'Matara Regional Office')

    doc.save()

    for letter in letters:
        letter.status = 'sent'
        letter.sent_date = date.today()
    db.session.commit()

    flash(f'ලිපි {len(letters)} ක් මුද්‍රණය කර යවන ලදී ලෙස සලකුණු කරන ලදී', 'success')
    return send_file(filepath, as_attachment=True, download_name=filename)

# ─────────────────────── Legal Proceed ───────────────────────

@app.route('/legal_proceed')
def legal_proceed():
    search = request.args.get('search', '')
    scheme_filter = request.args.get('scheme', '')

    q = Customer.query.filter(Customer.stage.in_(['second_reminder', 'legal']))
    if search:
        q = q.filter(db.or_(
            Customer.account_no.like(f'%{search}%'),
            Customer.name.like(f'%{search}%'),
            Customer.address.like(f'%{search}%')
        ))
    if scheme_filter:
        q = q.filter_by(scheme=scheme_filter)
    customers = q.all()

    eligible = []
    for c in customers:
        has_delivered = ReminderLetter.query.filter_by(
            customer_id=c.id, status='delivered'
        ).first()
        has_returned = ReminderLetter.query.filter_by(
            customer_id=c.id, status='returned'
        ).first()

        if has_delivered and not has_returned:
            eligible.append(c)

    schemes = db.session.query(Customer.scheme).distinct().filter(Customer.scheme.isnot(None), Customer.scheme != '').all()

    return render_template('legal_proceed.html', customers=eligible,
        schemes=sorted(set(s[0] for s in schemes if s[0])),
        fmt_date=fmt_date, fmt_amount=fmt_amount)

@app.route('/legal_proceed/generate-report')
def generate_legal_proceed_report():
    eligible = []
    customers = Customer.query.filter(Customer.stage.in_(['second_reminder', 'legal'])).all()

    for c in customers:
        has_delivered = ReminderLetter.query.filter_by(
            customer_id=c.id, status='delivered'
        ).first()
        has_returned = ReminderLetter.query.filter_by(
            customer_id=c.id, status='returned'
        ).first()

        if has_delivered and not has_returned:
            eligible.append(c)

    if not eligible:
        flash('වාර්තාවට ඇතුළත් කිරීමට පාරිභෝගිකයන් නොමැත', 'warning')
        return redirect(url_for('legal_proceed'))

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'නීති අංශයට වාර්තාව'

    ws.merge_cells('A1:H1')
    ws['A1'] = 'National Water Supply & Drainage Board - Matara Regional Office'
    ws['A1'].font = Font(bold=True, size=14)
    ws['A1'].alignment = Alignment(horizontal='center')

    ws.merge_cells('A2:H2')
    ws['A2'] = 'Report for Legal Division - Customers for Legal Action'
    ws['A2'].font = Font(bold=True, size=12)
    ws['A2'].alignment = Alignment(horizontal='center')

    ws.merge_cells('A3:H3')
    ws['A3'] = f'Date: {fmt_date(date.today())}'
    ws['A3'].alignment = Alignment(horizontal='center')

    headers = ['No', 'Account No', 'Customer Name', 'Address', 'Category',
               'Scheme', 'Outstanding (Rs.)', 'Remarks']
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=5, column=col, value=h)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal='center', wrap_text=True)
        cell.border = Border(bottom=Side(style='thin'))

    for idx, c in enumerate(eligible, 1):
        row = idx + 5
        ws.cell(row=row, column=1, value=idx)
        ws.cell(row=row, column=2, value=c.account_no)
        ws.cell(row=row, column=3, value=c.name)
        ws.cell(row=row, column=4, value=c.address)
        ws.cell(row=row, column=5, value=c.category or '')
        ws.cell(row=row, column=6, value=scheme_name(c.scheme) if c.scheme else '')
        amount = sum(d.amount_due for d in c.disconnections)
        ws.cell(row=row, column=7, value=amount)
        ws.cell(row=row, column=8, value='')
        for col in range(1, 9):
            ws.cell(row=row, column=col).border = Border(bottom=Side(style='thin'))

    for col_letter, w in zip(['A','B','C','D','E','F','G','H'], [8, 18, 30, 40, 20, 25, 15, 20]):
        ws.column_dimensions[col_letter].width = w

    filename = f'Legal_Proceed_Report_{date.today().isoformat()}.xlsx'
    filepath = os.path.join(REPORTS_DIR, filename)
    wb.save(filepath)

    for c in eligible:
        c.stage = 'legal'
    db.session.commit()

    flash(f'නීති අංශය සඳහා වාර්තාව ජනනය කරන ලදී. පාරිභෝගිකයන් {len(eligible)} දෙනෙකු නීතිමය කටයුතු සඳහා යොමු කරන ලදී', 'success')
    return send_file(filepath, as_attachment=True, download_name=filename)

# ─────────────────────── API ───────────────────────

@app.route('/api/customer/<path:account_no>')
def api_customer(account_no):
    c = Customer.query.filter_by(account_no=account_no).first()
    if c:
        return jsonify({
            'name': c.name, 'address': c.address, 'category': c.category,
            'phone': c.phone, 'zone': c.zone, 'scheme': c.scheme,
            'stage': c.stage
        })
    return jsonify({'error': 'පාරිභෝගිකයා සොයා ගත නොහැක'}), 404

# ─────────────────────── Direct Import from Storage ───────────────────────

@app.route('/import-from-storage')
def import_from_storage():
    filepath = os.path.join(STORAGE_DIR, 'Meter Discon Consumer 2025-10.xlsx')
    if not os.path.exists(filepath):
        flash('ගොනුව සොයා ගත නොහැක', 'danger')
        return redirect(url_for('import_customers'))

    wb = openpyxl.load_workbook(filepath)
    ws = wb.active
    imported = 0
    errors = 0

    for row_num in range(5, ws.max_row + 1):
        try:
            serial = ws.cell(row=row_num, column=1).value
            if serial is None:
                continue
            account_no = str(ws.cell(row=row_num, column=2).value or '').strip()
            if not account_no:
                continue
            if Customer.query.filter_by(account_no=account_no).first():
                continue

            category = str(ws.cell(row=row_num, column=3).value or '').strip()
            name_addr_raw = str(ws.cell(row=row_num, column=4).value or '')
            total_amount = float(ws.cell(row=row_num, column=5).value or 0)
            reading_info = str(ws.cell(row=row_num, column=6).value or '')

            parts = name_addr_raw.split('\n')
            name = parts[0].strip() if parts else ''
            address = '\n'.join(p.strip() for p in parts[1:]).strip() if len(parts) > 1 else ''
            if not address:
                address = name_addr_raw

            read_parts = reading_info.split('\n')
            last_reading = None
            last_read_date = None
            disconn_date = None
            try:
                if len(read_parts) > 0 and read_parts[0].strip().isdigit():
                    last_reading = int(read_parts[0].strip())
                if len(read_parts) > 1:
                    last_read_date = parse_date(read_parts[1].strip())
                if len(read_parts) > 2:
                    disconn_date = parse_date(read_parts[2].strip())
            except:
                pass
            if not disconn_date:
                disconn_date = date.today()

            scheme = extract_scheme(account_no)
            customer = Customer(
                account_no=account_no, name=name, address=address,
                category=category, stage='disconnected', scheme=scheme
            )
            db.session.add(customer)
            db.session.flush()

            disconnection = Disconnection(
                customer_id=customer.id, disconnection_date=disconn_date,
                amount_due=total_amount, last_reading=last_reading,
                last_read_date=last_read_date, reason='බිල්පත් ගෙවීම පැහැර හැරීම'
            )
            db.session.add(disconnection)
            imported += 1
        except Exception as e:
            errors += 1

    db.session.commit()
    flash(f'ගබඩාවෙන් පාරිභෝගිකයන් {imported} දෙනෙකු ආයාත කරන ලදී. දෝෂ: {errors}', 'success')
    return redirect(url_for('dcs_customers'))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

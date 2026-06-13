import os
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

SCHEMES = {
    '33': 'Makandura WSS',
    '35': 'Radampola WSS',
    '36': 'Thihagoda WSS',
    '37': 'Akuressa WSS',
    '38': 'Pitabeddara WSS',
    '39': 'Hakmana WSS',
    '60': 'Matara WSS',
    '61': 'Devinuwara WSS',
    '62': 'Gandara WSS',
    '63': 'Kottegoda WSS',
    '64': 'Dickwella WSS',
    '65': 'Weligama WSS',
    '66': 'Deniyaya WSS',
    '67': 'Kamburupitiya WSS',
    '68': 'Urubokka WSS',
    '69': 'Malimbada WSS',
    '70': 'Kudawella WSS',
}

def extract_scheme(account_no):
    """Extract scheme code from account no like 31/33/001/044/14 -> '33'"""
    if not account_no:
        return ''
    parts = account_no.split('/')
    if len(parts) >= 2:
        return parts[1]
    return ''

def scheme_name(code):
    return SCHEMES.get(code, f'WSS {code}' if code else '')


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default='user')       # admin | user
    is_verified = db.Column(db.Boolean, default=False)     # admin must verify new users
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Customer(db.Model):
    __tablename__ = 'customers'
    id = db.Column(db.Integer, primary_key=True)
    account_no = db.Column(db.String(50), unique=True, nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)
    address = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50))
    consumer_id = db.Column(db.String(50))
    nic = db.Column(db.String(20))
    phone = db.Column(db.String(20))
    zone = db.Column(db.String(100))
    station = db.Column(db.String(100))
    station_officer = db.Column(db.String(200))

    # Workflow
    scheme = db.Column(db.String(10), index=True)           # extracted from account_no: '33', '60' etc.
    stage = db.Column(db.String(30), default='disconnected') # disconnected | reconnected | first_reminder | ferrule_hold | ferrule_approved | oic_issued | second_reminder | legal
    stage_note = db.Column(db.String(300))                   # reason for hold/exclusion

    disconnections = db.relationship('Disconnection', backref='customer', lazy=True, cascade='all, delete-orphan')
    reminder_letters = db.relationship('ReminderLetter', backref='customer', lazy=True, cascade='all, delete-orphan')
    oic_orders = db.relationship('OICOrder', backref='customer', lazy=True, cascade='all, delete-orphan')


class Disconnection(db.Model):
    __tablename__ = 'disconnections'
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    disconnection_date = db.Column(db.Date, nullable=False, default=datetime.utcnow)
    original_ref = db.Column(db.String(100))
    amount_due = db.Column(db.Float, default=0.0)
    last_reading = db.Column(db.Integer)
    last_read_date = db.Column(db.Date)
    reason = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ReminderLetter(db.Model):
    __tablename__ = 'reminder_letters'
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    letter_type = db.Column(db.Integer, nullable=False)     # 1 = First Reminder, 2 = Second Reminder
    issue_date = db.Column(db.Date, nullable=False, default=datetime.utcnow)
    sent_date = db.Column(db.Date)
    returned_date = db.Column(db.Date)
    return_reason = db.Column(db.String(200))
    status = db.Column(db.String(20), default='pending')    # pending, sent, returned, delivered
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class OICOrder(db.Model):
    __tablename__ = 'oic_orders'
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    order_date = db.Column(db.Date, nullable=False, default=datetime.utcnow)
    form_ref = db.Column(db.String(50))
    station_officer = db.Column(db.String(200))
    amount_outstanding = db.Column(db.Float, default=0.0)
    reconnection_charge = db.Column(db.Float, default=3540.00)
    total_amount = db.Column(db.Float, default=0.0)
    status = db.Column(db.String(20), default='pending')    # pending, completed
    completed_date = db.Column(db.Date)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def init_db(app):
    with app.app_context():
        db.create_all()
        # Seed default admin if not exists
        if not User.query.filter_by(username='admin').first():
            admin = User(username='admin', role='admin', is_verified=True)
            admin.set_password('admin123')
            db.session.add(admin)
            db.session.commit()

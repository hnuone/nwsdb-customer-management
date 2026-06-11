const SCHEMES = {
    '33': 'Makandura WSS', '35': 'Radampola WSS', '36': 'Thihagoda WSS',
    '37': 'Akuressa WSS', '38': 'Pitabeddara WSS', '39': 'Hakmana WSS',
    '60': 'Matara WSS', '61': 'Devinuwara WSS', '62': 'Gandara WSS',
    '63': 'Kottegoda WSS', '64': 'Dickwella WSS', '65': 'Weligama WSS',
    '66': 'Deniyaya WSS', '67': 'Kamburupitiya WSS', '68': 'Urubokka WSS',
    '69': 'Malimbada WSS', '70': 'Kudawella WSS'
};

const STAGES = ['disconnected', 'first_reminder', 'ferrule_hold', 'ferrule_approved', 'oic_issued', 'second_reminder', 'legal', 'reconnected'];
const STAGE_LABELS = { disconnected: 'stage_disconnected', reconnected: 'stage_reconnected', first_reminder: 'stage_first_reminder', ferrule_hold: 'stage_ferrule_hold', ferrule_approved: 'stage_ferrule_approved', oic_issued: 'stage_oic_issued', second_reminder: 'stage_second_reminder', legal: 'stage_legal' };
const STAGE_BADGES = { disconnected: 'bg-secondary', reconnected: 'bg-success', first_reminder: 'bg-info', ferrule_hold: 'bg-warning text-dark', ferrule_approved: 'bg-primary', oic_issued: 'bg-warning text-dark', second_reminder: 'bg-info', legal: 'bg-danger' };

const schemeCodes = Object.keys(SCHEMES);
const firstNames = ['Saman', 'Nimal', 'Sunil', 'Priya', 'Lalith', 'Upali', 'Dinesh', 'Rohan', 'Kumara', 'Ajith', 'Gamini', 'Hemantha', 'Jayasiri', 'Lasantha', 'Mahesh', 'Nishantha', 'Prasanna', 'Ranjan', 'Sagara', 'Thilak'];
const lastNames = ['Fernando', 'Silva', 'Perera', 'Bandara', 'Jayawardena', 'Wickramasinghe', 'Rajapaksa', 'Herath', 'Senanayake', 'Gunasekara', 'Ariyaratne', 'Dissanayake', 'Ekanayake', 'Gunawardena', 'Hettiarachchi', 'Karunaratne', 'Liyanage', 'Mendis', 'Pathirana', 'Ratnayake'];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }

function pad(n, d) { return String(n).padStart(d, '0'); }

const customers = [];
const disconnections = [];
const reminderLetters = [];
const oicOrders = [];

for (let i = 1; i <= 55; i++) {
    const scheme = pick(schemeCodes);
    const acc = `31/${scheme}/${pad(rand(1, 999), 3)}/${pad(rand(1, 999), 3)}/${pad(rand(1, 99), 2)}`;
    const name = `${pick(firstNames)} ${pick(lastNames)}`;

    let stage;
    if (i <= 15) stage = 'disconnected';
    else if (i <= 25) stage = 'first_reminder';
    else if (i <= 32) stage = 'ferrule_hold';
    else if (i <= 38) stage = 'ferrule_approved';
    else if (i <= 44) stage = 'oic_issued';
    else if (i <= 49) stage = 'second_reminder';
    else if (i <= 52) stage = 'legal';
    else stage = 'reconnected';

    const cat = pick(['Domestic', 'Commercial', 'Industrial', 'Religious']);
    const zone = pick(['Matara', 'Weligama', 'Akuressa', 'Deniyaya', 'Hakmana', 'Kamburupitiya']);

    customers.push({
        id: i,
        account_no: acc,
        name: name,
        address: `${rand(1, 250)}, ${pick(['Main St', 'Temple Rd', 'Station Rd', 'School Ln', 'Hospital Rd', 'Beach Rd', 'Lake Rd', 'Galle Rd', 'Kandy Rd', 'Market St'])}, ${zone}`,
        phone: `071${pad(rand(1000000, 9999999), 7)}`,
        scheme: scheme,
        category: cat,
        zone: zone,
        stage: stage,
        stage_note: stage === 'ferrule_hold' ? pick(['Payment plan', 'Complaint under review', 'Special reason']) : (stage === 'legal' ? 'Sent to legal division' : ''),
        consumer_id: `CM${pad(i, 5)}`,
        nic: `${rand(800000000, 999999999)}V`,
        station: pick(['Main Station', 'Branch 1', 'Branch 2', 'Sub Station']),
        station_officer: pick(['Mr. Perera', 'Mr. Silva', 'Mrs. Jayawardena', 'Mr. Bandara']),
    });

    // Disconnection record
    const dDate = new Date(2025, rand(0, 9), rand(1, 28));
    const lastRead = new Date(dDate);
    lastRead.setDate(lastRead.getDate() - rand(10, 60));
    disconnections.push({
        id: i,
        customer_id: i,
        disconnection_date: dDate.toISOString().split('T')[0],
        last_reading: rand(1000, 99999),
        last_read_date: lastRead.toISOString().split('T')[0],
        reason: pick(['Non-payment', 'Non-payment 6+ months', 'Tampering', 'Illegal connection']),
        amount_due: rand(5000, 85000),
    });

    // Reminder letters for some
    if (stage !== 'disconnected' && stage !== 'reconnected') {
        const lDate = new Date(2025, rand(2, 10), rand(1, 28));
        reminderLetters.push({
            id: reminderLetters.length + 1,
            customer_id: i,
            letter_type: 1,
            issue_date: lDate.toISOString().split('T')[0],
            status: stage === 'first_reminder' ? 'pending' : pick(['sent', 'delivered', 'returned']),
            sent_date: lDate.toISOString().split('T')[0],
            returned_date: null,
            return_reason: null,
            delivered_date: null,
        });
    }
    if (['oic_issued', 'second_reminder', 'legal'].includes(stage)) {
        const lDate = new Date(2025, rand(5, 10), rand(1, 28));
        reminderLetters.push({
            id: reminderLetters.length + 1,
            customer_id: i,
            letter_type: 2,
            issue_date: lDate.toISOString().split('T')[0],
            status: stage === 'second_reminder' ? 'pending' : pick(['sent', 'delivered']),
            sent_date: lDate.toISOString().split('T')[0],
            returned_date: null,
            return_reason: null,
            delivered_date: null,
        });
    }

    // OIC orders for approved+
    if (['ferrule_approved', 'oic_issued', 'second_reminder', 'legal'].includes(stage)) {
        const oDate = new Date(2025, rand(4, 10), rand(1, 28));
        oicOrders.push({
            id: oicOrders.length + 1,
            customer_id: i,
            amount_outstanding: rand(5000, 85000),
            total_amount: rand(8500, 95000),
            order_date: oDate.toISOString().split('T')[0],
            status: stage === 'ferrule_approved' ? 'pending' : pick(['pending', 'completed']),
            completed_date: stage === 'legal' ? new Date(2025, rand(6, 11), rand(1, 28)).toISOString().split('T')[0] : null,
        });
    }
}

const data = { customers, disconnections, reminderLetters, oicOrders, SCHEMES, STAGES, STAGE_LABELS, STAGE_BADGES };
function schemeName(code) { return SCHEMES[code] || ''; }
function stageBadge(stage) { return STAGE_BADGES[stage] || 'bg-secondary'; }
function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return dt.toLocaleDateString('en-CA'); }
function fmtAmount(n) { return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ─── Users ───
const USERS = { admin: 'admin123', user: 'user123' };

// ─── Auth ───
function checkAuth() {
    var logged = localStorage.getItem('loggedIn');
    if (logged === 'true') {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-wrapper').style.display = 'block';
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-wrapper').style.display = 'none';
    }
    translatePage();
}

function doLogin() {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    if (USERS[username] && USERS[username] === password) {
        localStorage.setItem('loggedIn', 'true');
        errEl.style.display = 'none';
        checkAuth();
        navigate('dashboard');
    } else {
        errEl.textContent = _('Invalid username or password');
        errEl.style.display = 'block';
        document.querySelector('.login-overlay .login-card').classList.add('shake');
        setTimeout(function() { document.querySelector('.login-overlay .login-card').classList.remove('shake'); }, 500);
        document.getElementById('login-password').value = '';
    }
}

function doLogout() {
    localStorage.removeItem('loggedIn');
    checkAuth();
}

// ─── SPA Navigation ───
function navigate(page) { location.hash = page; }

function getPage() { return location.hash.slice(1) || 'dashboard'; }

function updateActiveNav(page) {
    document.querySelectorAll('.sidebar .nav-link').forEach(function(a) { a.classList.remove('active'); });
    var link = document.querySelector('.sidebar .nav-link[data-page="' + page + '"]');
    if (link) link.classList.add('active');
}

function renderPage() {
    var page = getPage();
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    var el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    updateActiveNav(page);
    if (renderers[page]) renderers[page]();
}

window.addEventListener('hashchange', renderPage);
window.addEventListener('load', function() { checkAuth(); renderPage(); });

// ─── Language ───
function setLang(code) {
    localStorage.setItem('lang', code);
    document.querySelectorAll('a[data-lang]').forEach(function(a) { a.classList.remove('active'); });
    document.querySelectorAll('a[data-lang="' + code + '"]').forEach(function(a) { a.classList.add('active'); });
    document.documentElement.lang = code;
    renderPage();
}

function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
        el.textContent = _(el.getAttribute('data-i18n'));
    });
}

function schemeDisplay(code) { return (code || '') + ' - ' + (SCHEMES[code] || ''); }

function getSchemes() {
    var s = new Set();
    customers.forEach(function(c) { if (c.scheme) s.add(c.scheme); });
    return Array.from(s).sort();
}

function getCustomerDisconnections(id) { return disconnections.filter(function(d) { return d.customer_id === id; }); }
function getCustomerLetters(id) { return reminderLetters.filter(function(l) { return l.customer_id === id; }); }
function getCustomerOIC(id) { return oicOrders.filter(function(o) { return o.customer_id === id; }); }
function getFirstLetter(id) { return disconnections.find(function(d) { return d.customer_id === id; }); }

// ─── Dashboard ───
function renderDashboard() {
    var byStage = { total: customers.length };
    STAGES.forEach(function(s) { byStage[s] = 0; });
    customers.forEach(function(c) { if (byStage[c.stage] !== undefined) byStage[c.stage]++; });

    var pendingFirst = reminderLetters.filter(function(l) { return l.letter_type === 1 && l.status === 'sent'; }).length;
    var pendingOic = oicOrders.filter(function(o) { return o.status === 'pending'; }).length;
    var returnedMail = reminderLetters.filter(function(l) { return l.status === 'returned'; }).length;
    var pendingSecond = reminderLetters.filter(function(l) { return l.letter_type === 2 && l.status === 'sent'; }).length;

    document.getElementById('dash-total').textContent = byStage.total;
    document.getElementById('dash-disconnected').textContent = byStage.disconnected || 0;
    document.getElementById('dash-reconnected').textContent = byStage.reconnected || 0;
    document.getElementById('dash-legal').textContent = byStage.legal || 0;
    document.getElementById('dash-first-sent').textContent = pendingFirst;
    document.getElementById('dash-ferrule').textContent = (byStage.first_reminder || 0) + (byStage.ferrule_hold || 0) + (byStage.ferrule_approved || 0);
    document.getElementById('dash-oic').textContent = pendingOic;
    document.getElementById('dash-returned').textContent = returnedMail;
    document.getElementById('dash-second-sent').textContent = pendingSecond;

    var recent = customers.slice(-10).reverse();
    var tbody = document.getElementById('dash-recent');
    if (recent.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">' + _('No customers yet') + '</td></tr>';
    } else {
        tbody.innerHTML = recent.map(function(c) {
            return '<tr><td><code>' + c.account_no + '</code></td><td>' + c.name + '</td><td><span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span></td><td><span class="badge ' + stageBadge(c.stage) + ' badge-stage">' + _(STAGE_LABELS[c.stage] || c.stage) + '</span></td><td><a class="btn btn-sm btn-outline-primary" href="javascript:void(0)" onclick="showCustomer(' + c.id + ')"><i class="bi bi-eye"></i></a></td></tr>';
        }).join('');
    }
    translatePage();
}

// ─── Customer Detail ───
function showCustomer(id) {
    var c = customers.find(function(x) { return x.id === id; });
    if (!c) return;
    var discons = getCustomerDisconnections(id);
    var letters = getCustomerLetters(id);
    var oics = getCustomerOIC(id);

    document.getElementById('cd-account').textContent = c.account_no;
    document.getElementById('cd-name').textContent = c.name;
    document.getElementById('cd-address').textContent = c.address;
    document.getElementById('cd-phone').textContent = c.phone;
    document.getElementById('cd-scheme').innerHTML = '<span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span>';
    document.getElementById('cd-category').textContent = c.category || '-';
    document.getElementById('cd-zone').textContent = c.zone || '-';
    document.getElementById('cd-stage').innerHTML = '<span class="badge ' + stageBadge(c.stage) + ' badge-stage">' + _(STAGE_LABELS[c.stage] || c.stage) + '</span>';
    document.getElementById('cd-note').textContent = c.stage_note || '-';

    var dtbody = document.getElementById('cd-disconnections');
    if (discons.length === 0) {
        dtbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">-</td></tr>';
    } else {
        dtbody.innerHTML = discons.map(function(d) {
            return '<tr><td>' + fmtDate(d.disconnection_date) + '</td><td>' + d.last_reading + '</td><td>' + fmtDate(d.last_read_date) + '</td><td>' + d.reason + '</td><td>Rs. ' + fmtAmount(d.amount_due) + '</td></tr>';
        }).join('');
    }

    var ltbody = document.getElementById('cd-letters');
    if (letters.length === 0) {
        ltbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">-</td></tr>';
    } else {
        ltbody.innerHTML = letters.map(function(l) {
            var bg = l.status === 'pending' ? 'secondary' : l.status === 'sent' ? 'primary' : l.status === 'delivered' ? 'success' : 'danger';
            return '<tr><td>' + (l.letter_type === 1 ? 'First' : 'Second') + '</td><td>' + fmtDate(l.issue_date) + '</td><td><span class="badge bg-' + bg + '">' + _(l.status.charAt(0).toUpperCase() + l.status.slice(1)) + '</span></td><td>' + (l.return_reason || '-') + '</td></tr>';
        }).join('');
    }

    var otbody = document.getElementById('cd-oic');
    if (oics.length === 0) {
        otbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">-</td></tr>';
    } else {
        otbody.innerHTML = oics.map(function(o) {
            var ref = 'OIC/' + String(o.id).padStart(5, '0') + '/' + new Date(o.order_date).getFullYear();
            return '<tr><td><code>' + ref + '</code></td><td>' + fmtDate(o.order_date) + '</td><td><span class="badge bg-' + (o.status === 'pending' ? 'warning text-dark' : 'success') + '">' + _(o.status === 'pending' ? 'Pending' : 'Completed') + '</span></td><td>Rs. ' + fmtAmount(o.total_amount) + '</td></tr>';
        }).join('');
    }

    navigate('customer-detail');
    translatePage();
}

// ─── DCs Customers ───
function renderDCsCustomers() {
    var search = (document.getElementById('dcs-search').value || '').toLowerCase();
    var stage = document.getElementById('dcs-stage').value || '';
    var scheme = document.getElementById('dcs-scheme').value || '';

    var stageSelect = document.getElementById('dcs-stage');
    stageSelect.innerHTML = '<option value="">' + _('All Stages') + '</option>' + STAGES.map(function(s) { return '<option value="' + s + '">' + _(STAGE_LABELS[s] || s) + '</option>'; }).join('');
    stageSelect.value = stage;
    var schemeSelect = document.getElementById('dcs-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;

    var list = customers;
    if (search) list = list.filter(function(c) { return c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1 || c.phone.indexOf(search) !== -1; });
    if (stage) list = list.filter(function(c) { return c.stage === stage; });
    if (scheme) list = list.filter(function(c) { return c.scheme === scheme; });

    var tbody = document.getElementById('dcs-table');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = list.map(function(c) {
            var amt = getFirstLetter(c.id);
            return '<tr><td><code>' + c.account_no + '</code></td><td><a href="javascript:void(0)" onclick="showCustomer(' + c.id + ')">' + c.name + '</a></td><td><span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span></td><td>Rs. ' + fmtAmount(amt ? amt.amount_due : 0) + '</td><td><span class="badge ' + stageBadge(c.stage) + ' badge-stage">' + _(STAGE_LABELS[c.stage] || c.stage) + '</span></td><td>' + (c.zone || '-') + '</td><td><a class="btn btn-sm btn-outline-primary" href="javascript:void(0)" onclick="showCustomer(' + c.id + ')"><i class="bi bi-eye"></i></a></td></tr>';
        }).join('');
    }
    document.getElementById('dcs-count').textContent = list.length;
    translatePage();
}

// ─── Reconnected ───
function renderReconnected() {
    var search = (document.getElementById('rec-search').value || '').toLowerCase();
    var scheme = document.getElementById('rec-scheme').value || '';
    var schemeSelect = document.getElementById('rec-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;

    var active = customers.filter(function(c) { return c.stage !== 'reconnected'; });
    var reconn = customers.filter(function(c) { return c.stage === 'reconnected'; });

    var list = active;
    if (search) list = list.filter(function(c) { return c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1 || c.phone.indexOf(search) !== -1; });
    if (scheme) list = list.filter(function(c) { return c.scheme === scheme; });

    var rl = document.getElementById('rec-reconnected-list');
    if (reconn.length === 0) {
        rl.innerHTML = '<p class="text-muted my-3 text-center">' + _('No records found') + '</p>';
    } else {
        var html = '<div class="table-responsive" style="max-height:300px"><table class="table table-sm"><thead><tr><th>' + _('Account No') + '</th><th>' + _('Customer Name') + '</th></tr></thead><tbody>';
        reconn.forEach(function(c) { html += '<tr><td><code>' + c.account_no + '</code></td><td>' + c.name + '</td></tr>'; });
        html += '</tbody></table></div>';
        rl.innerHTML = html;
    }

    var tbody = document.getElementById('rec-table');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = list.map(function(c) {
            var amt = getFirstLetter(c.id);
            return '<tr><td><input type="checkbox" class="rec-cb" value="' + c.id + '"></td><td><code>' + c.account_no + '</code></td><td>' + c.name + '</td><td><span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span></td><td>Rs. ' + fmtAmount(amt ? amt.amount_due : 0) + '</td><td><span class="badge ' + stageBadge(c.stage) + ' badge-stage">' + _(STAGE_LABELS[c.stage] || c.stage) + '</span></td></tr>';
        }).join('');
    }
    translatePage();
}

// ─── First Reminders ───
function renderFirstReminders() {
    var search = (document.getElementById('fr-search').value || '').toLowerCase();
    var scheme = document.getElementById('fr-scheme').value || '';
    var status = document.getElementById('fr-status').value || '';

    var schemeSelect = document.getElementById('fr-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;
    document.getElementById('fr-status').value = status;

    var list = reminderLetters.filter(function(l) { return l.letter_type === 1; });
    if (search) {
        list = list.filter(function(l) {
            var c = customers.find(function(x) { return x.id === l.customer_id; });
            return c && (c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1);
        });
    }
    if (scheme) {
        list = list.filter(function(l) {
            var c = customers.find(function(x) { return x.id === l.customer_id; });
            return c && c.scheme === scheme;
        });
    }
    if (status) list = list.filter(function(l) { return l.status === status; });

    var all = reminderLetters.filter(function(l) { return l.letter_type === 1; });
    document.getElementById('fr-total').textContent = all.length;
    document.getElementById('fr-pending').textContent = all.filter(function(l) { return l.status === 'pending'; }).length;
    document.getElementById('fr-sent').textContent = all.filter(function(l) { return l.status === 'sent'; }).length;
    document.getElementById('fr-delivered').textContent = all.filter(function(l) { return l.status === 'delivered'; }).length;
    document.getElementById('fr-returned').textContent = all.filter(function(l) { return l.status === 'returned'; }).length;

    var tbody = document.getElementById('fr-table');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = list.map(function(l) {
            var c = customers.find(function(x) { return x.id === l.customer_id; });
            if (!c) return '';
            var bg = l.status === 'pending' ? 'secondary' : l.status === 'sent' ? 'primary' : l.status === 'delivered' ? 'success' : 'danger';
            var statusText = _(l.status.charAt(0).toUpperCase() + l.status.slice(1));
            var ret = l.returned_date ? fmtDate(l.returned_date) + (l.return_reason ? '<br><small>' + l.return_reason + '</small>' : '') : '-';
            return '<tr><td><code>' + c.account_no + '</code></td><td><a href="javascript:void(0)" onclick="showCustomer(' + c.id + ')">' + c.name.substring(0, 25) + '</a></td><td>' + (c.category || '-') + '</td><td>' + fmtDate(l.issue_date) + '</td><td>' + (l.sent_date ? fmtDate(l.sent_date) : '-') + '</td><td><span class="badge bg-' + bg + '">' + statusText + '</span></td><td>' + ret + '</td></tr>';
        }).join('');
    }
    translatePage();
}

// ─── Ferrule Processing ───
function renderFerruleProcessing() {
    var search = (document.getElementById('fp-search').value || '').toLowerCase();
    var scheme = document.getElementById('fp-scheme').value || '';
    var schemeSelect = document.getElementById('fp-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;

    var list = customers.filter(function(c) { return ['first_reminder', 'ferrule_hold'].indexOf(c.stage) !== -1; });
    if (search) list = list.filter(function(c) { return c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1; });
    if (scheme) list = list.filter(function(c) { return c.scheme === scheme; });

    var tbody = document.getElementById('fp-table');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = list.map(function(c) {
            var amt = getFirstLetter(c.id);
            return '<tr><td><code>' + c.account_no + '</code></td><td><a href="javascript:void(0)" onclick="showCustomer(' + c.id + ')">' + c.name + '</a></td><td><span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span></td><td>Rs. ' + fmtAmount(amt ? amt.amount_due : 0) + '</td><td><span class="badge ' + stageBadge(c.stage) + ' badge-stage">' + _(STAGE_LABELS[c.stage] || c.stage) + '</span></td><td><small class="text-muted">' + (c.stage_note || '') + '</small></td><td><span class="badge bg-warning text-dark">' + _('Select Action') + '</span></td></tr>';
        }).join('');
    }
    translatePage();
}

// ─── Second Reminders ───
function renderSecondReminders() {
    var search = (document.getElementById('sr-search').value || '').toLowerCase();
    var scheme = document.getElementById('sr-scheme').value || '';
    var status = document.getElementById('sr-status').value || '';

    var schemeSelect = document.getElementById('sr-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;
    document.getElementById('sr-status').value = status;

    var list = reminderLetters.filter(function(l) { return l.letter_type === 2; });
    if (search) {
        list = list.filter(function(l) {
            var c = customers.find(function(x) { return x.id === l.customer_id; });
            return c && (c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1);
        });
    }
    if (scheme) {
        list = list.filter(function(l) {
            var c = customers.find(function(x) { return x.id === l.customer_id; });
            return c && c.scheme === scheme;
        });
    }
    if (status) list = list.filter(function(l) { return l.status === status; });

    var all = reminderLetters.filter(function(l) { return l.letter_type === 2; });
    document.getElementById('sr-total').textContent = all.length;
    document.getElementById('sr-pending').textContent = all.filter(function(l) { return l.status === 'pending'; }).length;
    document.getElementById('sr-sent').textContent = all.filter(function(l) { return l.status === 'sent'; }).length;
    document.getElementById('sr-delivered').textContent = all.filter(function(l) { return l.status === 'delivered'; }).length;
    document.getElementById('sr-returned').textContent = all.filter(function(l) { return l.status === 'returned'; }).length;

    var tbody = document.getElementById('sr-table');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = list.map(function(l) {
            var c = customers.find(function(x) { return x.id === l.customer_id; });
            if (!c) return '';
            var bg = l.status === 'pending' ? 'secondary' : l.status === 'sent' ? 'primary' : l.status === 'delivered' ? 'success' : 'danger';
            var statusText = _(l.status.charAt(0).toUpperCase() + l.status.slice(1));
            var ret = l.returned_date ? fmtDate(l.returned_date) + (l.return_reason ? '<br><small>' + l.return_reason + '</small>' : '') : '-';
            return '<tr><td><code>' + c.account_no + '</code></td><td><a href="javascript:void(0)" onclick="showCustomer(' + c.id + ')">' + c.name.substring(0, 25) + '</a></td><td>' + (c.category || '-') + '</td><td>' + fmtDate(l.issue_date) + '</td><td>' + (l.sent_date ? fmtDate(l.sent_date) : '-') + '</td><td><span class="badge bg-' + bg + '">' + statusText + '</span></td><td>' + ret + '</td></tr>';
        }).join('');
    }
    translatePage();
}

// ─── OIC Orders ───
function renderOICOrders() {
    var search = (document.getElementById('oic-search').value || '').toLowerCase();
    var scheme = document.getElementById('oic-scheme').value || '';
    var status = document.getElementById('oic-status').value || '';

    var schemeSelect = document.getElementById('oic-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;
    document.getElementById('oic-status').value = status;

    var list = oicOrders;
    if (search) {
        list = list.filter(function(o) {
            var c = customers.find(function(x) { return x.id === o.customer_id; });
            return c && (c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1);
        });
    }
    if (scheme) {
        list = list.filter(function(o) {
            var c = customers.find(function(x) { return x.id === o.customer_id; });
            return c && c.scheme === scheme;
        });
    }
    if (status) list = list.filter(function(o) { return o.status === status; });

    document.getElementById('oic-total').textContent = oicOrders.length;
    document.getElementById('oic-pending').textContent = oicOrders.filter(function(o) { return o.status === 'pending'; }).length;
    document.getElementById('oic-completed').textContent = oicOrders.filter(function(o) { return o.status === 'completed'; }).length;

    var tbody = document.getElementById('oic-table');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = list.map(function(o) {
            var c = customers.find(function(x) { return x.id === o.customer_id; });
            if (!c) return '';
            var ref = 'OIC/' + String(o.id).padStart(5, '0') + '/' + new Date(o.order_date).getFullYear();
            return '<tr><td><code>' + ref + '</code></td><td><code>' + c.account_no + '</code></td><td>' + c.name + '</td><td><span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span></td><td>Rs. ' + fmtAmount(o.amount_outstanding) + '</td><td><strong>Rs. ' + fmtAmount(o.total_amount) + '</strong></td><td>' + fmtDate(o.order_date) + '</td><td><span class="badge bg-' + (o.status === 'pending' ? 'warning text-dark' : 'success') + '">' + _(o.status === 'pending' ? 'Pending' : 'Completed') + '</span></td></tr>';
        }).join('');
    }
    translatePage();
}

// ─── Legal Proceed ───
function renderLegalProceed() {
    var search = (document.getElementById('lp-search').value || '').toLowerCase();
    var scheme = document.getElementById('lp-scheme').value || '';

    var schemeSelect = document.getElementById('lp-scheme');
    schemeSelect.innerHTML = '<option value="">' + _('All Schemes') + '</option>' + getSchemes().map(function(s) { return '<option value="' + s + '">' + schemeDisplay(s) + '</option>'; }).join('');
    schemeSelect.value = scheme;

    var candidates = customers.filter(function(c) { return ['second_reminder', 'legal'].indexOf(c.stage) !== -1; });
    if (search) candidates = candidates.filter(function(c) { return c.account_no.toLowerCase().indexOf(search) !== -1 || c.name.toLowerCase().indexOf(search) !== -1 || c.address.toLowerCase().indexOf(search) !== -1; });
    if (scheme) candidates = candidates.filter(function(c) { return c.scheme === scheme; });

    var eligible = [];
    candidates.forEach(function(c) {
        var hasDelivered = reminderLetters.some(function(l) { return l.customer_id === c.id && l.status === 'delivered'; });
        var hasReturned = reminderLetters.some(function(l) { return l.customer_id === c.id && l.status === 'returned'; });
        if (hasDelivered && !hasReturned) eligible.push(c);
    });

    var tbody = document.getElementById('lp-table');
    if (eligible.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' + _('No records found') + '</td></tr>';
    } else {
        tbody.innerHTML = eligible.map(function(c, i) {
            var amt = getFirstLetter(c.id);
            var addr = c.address.length > 60 ? c.address.substring(0, 60) + '...' : c.address;
            return '<tr><td>' + (i + 1) + '</td><td><code>' + c.account_no + '</code></td><td><a href="javascript:void(0)" onclick="showCustomer(' + c.id + ')">' + c.name + '</a></td><td><span class="badge bg-secondary">' + schemeDisplay(c.scheme) + '</span></td><td>' + (c.category || '-') + '</td><td>Rs. ' + fmtAmount(amt ? amt.amount_due : 0) + '</td><td>' + addr + '</td></tr>';
        }).join('');
    }
    document.getElementById('lp-count').textContent = eligible.length;
    translatePage();
}

// ─── Register all renderers ───
var renderers = {
    'dashboard': renderDashboard,
    'dcs-customers': renderDCsCustomers,
    'reconnected': renderReconnected,
    'first-reminders': renderFirstReminders,
    'ferrule-processing': renderFerruleProcessing,
    'second-reminders': renderSecondReminders,
    'oic-orders': renderOICOrders,
    'legal-proceed': renderLegalProceed,
    'customer-detail': function() { translatePage(); },
    'import': function() { translatePage(); }
};

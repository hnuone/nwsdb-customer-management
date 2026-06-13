// ─── Auth ───
var currentUser = null;

function checkAuth() {
    var overlay = document.getElementById('login-overlay');
    var wrapper = document.getElementById('app-wrapper');
    if (!overlay || !wrapper) return;
    var logged = sessionStorage.getItem('nwsdb_logged');
    if (logged === '1') {
        var userData = sessionStorage.getItem('nwsdb_user');
        if (userData) currentUser = JSON.parse(userData);
        overlay.style.display = 'none';
        wrapper.style.display = 'block';
        updateSidebarUser();
    } else {
        currentUser = null;
        overlay.style.display = 'flex';
        wrapper.style.display = 'none';
    }
    translatePage();
}

function updateSidebarUser() {
    var info = document.getElementById('sidebar-user-info');
    var nameEl = document.getElementById('sidebar-username');
    var roleEl = document.getElementById('sidebar-role-badge');
    var verifyLink = document.getElementById('sidebar-verify-link');
    if (currentUser) {
        info.style.display = 'block';
        nameEl.textContent = currentUser.username;
        roleEl.innerHTML = ' <span class="badge bg-' + (currentUser.role === 'admin' ? 'danger' : 'primary') + '" style="font-size:0.6rem;">' + currentUser.role + '</span>';
        verifyLink.style.display = currentUser.role === 'admin' ? 'block' : 'none';
    } else {
        info.style.display = 'none';
        verifyLink.style.display = 'none';
    }
}

function doLogin() {
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    var user = findUser(username);
    if (!user || user.password !== password) {
        errEl.textContent = _('Invalid username or password');
        errEl.style.display = 'block';
        var card = document.querySelector('.login-overlay .login-card');
        if (card) { card.classList.add('shake'); setTimeout(function() { card.classList.remove('shake'); }, 500); }
        document.getElementById('login-password').value = '';
        return;
    }
    if (!user.is_verified) {
        errEl.textContent = _('Your account is not yet verified. Please contact the administrator.');
        errEl.style.display = 'block';
        document.getElementById('login-password').value = '';
        return;
    }
    sessionStorage.setItem('nwsdb_logged', '1');
    sessionStorage.setItem('nwsdb_user', JSON.stringify({ username: user.username, role: user.role }));
    errEl.style.display = 'none';
    showLogin();
    checkAuth();
    navigate('dashboard');
}

function doLogout() {
    sessionStorage.removeItem('nwsdb_logged');
    sessionStorage.removeItem('nwsdb_user');
    currentUser = null;
    checkAuth();
}

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    translatePage();
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('reg-error').style.display = 'none';
    document.getElementById('reg-success').style.display = 'none';
    document.getElementById('reg-username').value = '';
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-confirm').value = '';
    translatePage();
}

function doRegister() {
    var username = document.getElementById('reg-username').value.trim();
    var password = document.getElementById('reg-password').value;
    var confirm = document.getElementById('reg-confirm').value;
    var errEl = document.getElementById('reg-error');
    var successEl = document.getElementById('reg-success');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    if (!username || !password) {
        errEl.textContent = _('Please fill all fields');
        errEl.style.display = 'block';
        return;
    }
    if (password !== confirm) {
        errEl.textContent = _('Passwords do not match');
        errEl.style.display = 'block';
        return;
    }
    if (password.length < 4) {
        errEl.textContent = _('Password must be at least 4 characters');
        errEl.style.display = 'block';
        return;
    }
    var existing = findUser(username);
    if (existing) {
        errEl.textContent = _('Username already exists');
        errEl.style.display = 'block';
        return;
    }
    var users = getUsers();
    users.push({ username: username, password: password, role: 'user', is_verified: false });
    saveUsers(users);
    successEl.textContent = _('Account created successfully. Please wait for admin verification.');
    successEl.style.display = 'block';
    document.getElementById('reg-username').value = '';
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-confirm').value = '';
    translatePage();
}

// ─── Verify Users (admin) ───
function renderVerifyUsers() {
    var users = getUsers();
    var pending = users.filter(function(u) { return !u.is_verified; });
    var verified = users.filter(function(u) { return u.is_verified; });
    document.getElementById('vu-pending-count').textContent = pending.length;
    document.getElementById('vu-verified-count').textContent = verified.length;
    var pl = document.getElementById('vu-pending-list');
    if (pending.length === 0) {
        pl.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">' + _('No records found') + '</td></tr>';
    } else {
        pl.innerHTML = pending.map(function(u) {
            return '<tr><td>' + u.username + '</td><td><button class="btn btn-sm btn-success" onclick="verifyUser(\'' + u.username + '\')"><i class="bi bi-check-lg"></i> ' + _('Verify') + '</button></td></tr>';
        }).join('');
    }
    var vl = document.getElementById('vu-verified-list');
    if (verified.length === 0) {
        vl.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">' + _('No records found') + '</td></tr>';
    } else {
        vl.innerHTML = verified.map(function(u) {
            return '<tr><td>' + u.username + '</td><td><span class="badge bg-' + (u.role === 'admin' ? 'danger' : 'primary') + '">' + u.role + '</span></td></tr>';
        }).join('');
    }
    translatePage();
}

function verifyUser(username) {
    var users = getUsers();
    var u = users.find(function(x) { return x.username === username; });
    if (u) {
        u.is_verified = true;
        saveUsers(users);
        renderVerifyUsers();
    }
}

// Run auth check immediately
checkAuth();

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
window.addEventListener('pageshow', function() { checkAuth(); });

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
    'verify-users': renderVerifyUsers,
    'import': function() { translatePage(); }
};

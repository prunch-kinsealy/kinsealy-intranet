/*
 * Shared quick-nav bar for standalone (non-index.html) staff pages.
 * Drop `<div id="kmc-quicknav"></div>` right after <body>, then
 * `<script src="shared-nav.js"></script>` right after it. Reads the same
 * sessionStorage keys index.html sets on login (kmc-auth, kmc-role,
 * kmc-edit-sections) — it's display-only and never gates access itself;
 * each page keeps its own server/role checks.
 */
(function () {
  var SECTIONS = [
    ['home', '🏠 Home & Noticeboard'],
    ['cdm', '🔁 CDM'],
    ['care-pathways', '🩺 Patient Journeys'],
    ['clinical-procedures', '💉 Clinical Procedures'],
    ['clinical-pathways', '🧬 Clinical Pathways'],
    ['doctor-stuff', '👨‍⚕️ Doctor Protocols'],
    ['front-of-house', '🏥 Front of House'],
    ['practice-management', '📋 Practice Management'],
    ['metrics', '📊 Metrics'],
    ['text-templates', '💬 Text Templates'],
    ['useful-forms', '📄 Useful Forms'],
    ['ai-at-kinsealy', '🤖 AI at Kinsealy'],
    ['social-media', '📱 Social Media'],
    ['maintenance', '🔧 Maintenance']
  ];

  // gate: null = always shown, 'admin' = kmc-role==='admin', 'edit' = has editSections
  var PAGES = [
    ['onboarding.html', '🎓 Staff Training Guide', null],
    ['propose-edit.html', '✏️ Propose an Edit', 'edit'],
    ['feedback.html', '💬 Staff Feedback', 'admin'],
    ['projects.html', '🗂️ Projects', 'admin'],
    ['approvals.html', '✅ Pending Approvals', 'admin'],
    ['staff-logins.html', '🔑 Staff Logins', 'admin'],
    ['recorder.html', '🎥 Step Recorder', 'admin']
  ];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function init() {
    var mount = document.getElementById('kmc-quicknav');
    if (!mount || !sessionStorage.getItem('kmc-auth')) return;

    var role = sessionStorage.getItem('kmc-role');
    var editSections = [];
    try { editSections = JSON.parse(sessionStorage.getItem('kmc-edit-sections') || '[]'); } catch (e) {}

    var here = (location.pathname.split('/').pop() || 'index.html');

    var sectionOpts = SECTIONS.map(function (s) {
      return '<option value="index.html#' + s[0] + '">' + esc(s[1]) + '</option>';
    }).join('');

    var visiblePages = PAGES.filter(function (p) {
      if (p[2] === 'admin') return role === 'admin';
      if (p[2] === 'edit') return Array.isArray(editSections) && editSections.length > 0;
      return true;
    });

    var pageOpts = visiblePages.map(function (p) {
      return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
    }).join('');

    var pageLinks = visiblePages.map(function (p) {
      var active = p[0] === here ? ' kmc-qn-active' : '';
      return '<a href="' + esc(p[0]) + '" class="kmc-qn-link' + active + '">' + esc(p[1]) + '</a>';
    }).join('');

    mount.innerHTML =
      '<style>' +
      '#kmc-quicknav{position:sticky;top:0;z-index:80;background:var(--navy,#1a2d4a);' +
      'display:flex;align-items:center;gap:14px;padding:9px 18px;flex-wrap:wrap;' +
      'font-family:\'DM Sans\',sans-serif}' +
      '#kmc-quicknav .kmc-qn-home{color:#fff;font-weight:600;font-size:0.82rem;' +
      'text-decoration:none;white-space:nowrap}' +
      '#kmc-quicknav .kmc-qn-home:hover{color:var(--teal-light,#3aa897)}' +
      '#kmc-quicknav select{background:rgba(255,255,255,0.1);color:#fff;' +
      'border:1px solid rgba(255,255,255,0.25);border-radius:6px;padding:5px 8px;' +
      'font-size:0.78rem;font-family:\'DM Sans\',sans-serif;max-width:100%}' +
      '#kmc-quicknav select option{color:#1f2937}' +
      '#kmc-quicknav .kmc-qn-links{display:flex;gap:14px;flex-wrap:wrap;margin-left:auto}' +
      '#kmc-quicknav .kmc-qn-link{color:rgba(255,255,255,0.68);font-size:0.78rem;' +
      'text-decoration:none;white-space:nowrap}' +
      '#kmc-quicknav .kmc-qn-link:hover,#kmc-quicknav .kmc-qn-link.kmc-qn-active{color:#fff}' +
      '@media(max-width:720px){#kmc-quicknav .kmc-qn-links{display:none}}' +
      '</style>' +
      '<a href="index.html" class="kmc-qn-home">🏠 Staff Hub</a>' +
      '<label class="kmc-qn-sr-only" for="kmc-qn-select" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Jump to a hub section or page</label>' +
      '<select id="kmc-qn-select" aria-label="Jump to a hub section or page" onchange="if(this.value){location.href=this.value}this.selectedIndex=0">' +
      '<option value="">Jump to…</option>' +
      '<optgroup label="Hub Sections">' + sectionOpts + '</optgroup>' +
      '<optgroup label="Pages &amp; Tools">' + pageOpts + '</optgroup>' +
      '</select>' +
      '<nav class="kmc-qn-links" aria-label="Pages and tools">' + pageLinks + '</nav>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

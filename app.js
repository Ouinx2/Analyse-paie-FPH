'use strict';
/* =====================================================================
   Analyse paie FPH — 100 % local. Aucun appel réseau, aucune donnée envoyée.
   1. Calculs (fonctions pures)  2. Stockage  3. Interface  4. Export
   ===================================================================== */

/* ---------- 1. CALCULS (fonctions pures) ---------- */
const pad = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const num = v => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return isFinite(n) ? n : null; };
const n0 = v => num(v) || 0;
const hh = m => (Math.round(m / 6) / 10).toString().replace('.', ',') + ' h';   // minutes -> heures (1 décimale)
const eur = v => v == null ? '?' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const aff = v => v.debut.replace('T', ' ') + ' → ' + v.fin.replace('T', ' ');

// Jours fériés français (métropole, hors Alsace-Moselle) : fixes + Pâques, Ascension, Pentecôte.
function paques(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), j = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(y, mo - 1, j);
}
function feries(y) {
  const p = paques(y), add = n => { const d = new Date(p); d.setDate(d.getDate() + n); return dstr(d); };
  return new Set([`${y}-01-01`, add(1), `${y}-05-01`, `${y}-05-08`, add(39), add(50), `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`]);
}

const estNuit = (min, p) => { const d = p.nuitDebut * 60, f = p.nuitFin * 60; return d > f ? (min >= d || min < f) : (min >= d && min < f); };

// Découpe minute par minute et rattache chaque minute à une date selon la règle :
// 'debut' (date de début), 'fin' (date de fin), 'calendaire' (chaque minute à son jour).
function decoupe(v, p, ratt) {
  const a = new Date(v.debut), b = new Date(v.fin);
  if (isNaN(a) || isNaN(b) || b <= a || b - a > 864e5) return null;
  const j = {}, fin = dstr(new Date(b - 6e4));
  for (let t = +a; t < +b; t += 6e4) {
    const d = new Date(t), cle = ratt === 'debut' ? dstr(a) : ratt === 'fin' ? fin : dstr(d);
    const o = j[cle] || (j[cle] = { date: cle, min: 0, nuit: 0 });
    o.min++; if (estNuit(d.getHours() * 60 + d.getMinutes(), p)) o.nuit++;
  }
  return j;
}
const ov = (f, auto) => f === 'oui' ? true : f === 'non' ? false : auto;   // forçage manuel dimanche / férié
function joursVac(v, p, ratt) {
  const d = decoupe(v, p, ratt); if (!d) return null;
  return Object.values(d).map(o => { const dt = new Date(o.date + 'T12:00'); return { ...o, dim: ov(v.dim, dt.getDay() === 0), fer: ov(v.fer, feries(dt.getFullYear()).has(o.date)) }; });
}
function totauxMois(vacs, p, mois, rDef) {
  const t = { n12: 0, min: 0, nuit: 0, dim: new Set(), fer: new Set() };
  for (const v of vacs) {
    if (v.nat !== 'travail') continue;
    const js = joursVac(v, p, v.ratt || rDef); if (!js) continue;
    if (js[0].date.startsWith(mois) && js.reduce((s, j) => s + j.min, 0) === 720) t.n12++;
    for (const j of js) if (j.date.startsWith(mois)) { t.min += j.min; t.nuit += j.nuit; if (j.dim) t.dim.add(j.date); if (j.fer) t.fer.add(j.date); }
  }
  return t;
}
function chevauchements(vacs) {
  const L = vacs.map(v => ({ id: v.id, a: +new Date(v.debut), b: +new Date(v.fin) })).filter(x => x.b > x.a).sort((x, y) => x.a - y.a), r = [];
  for (let i = 1; i < L.length; i++) for (let k = 0; k < i; k++) if (L[i].a < L[k].b) r.push([L[k].id, L[i].id]);
  return r;
}

const LAB = { tib: 'Traitement indiciaire', ir: 'Indemnité de résidence', segur: 'Ségur / CTI', suj: 'Sujétion', hs: 'Heures supp./compl.', nuit: 'Majorations de nuit', dimf: 'Dimanche / fériés', primes: 'Primes diverses' };
const TX = ' Une absence d’indemnité n’est pas forcément une erreur : les règles dépendent du statut, du service, du temps de travail, de l’accord d’établissement et du régime indemnitaire.';

// Contrôles : niveaux ok (vert) / warn (orange) / err (rouge, arithmétique) / na (gris, info manquante)
function controles(S) {
  const R = [], p = S.profil, add = (mois, niv, txt) => R.push({ mois, niv, txt });
  const B = [...S.buls].sort((a, b) => a.periode < b.periode ? -1 : 1);
  const gains = b => Object.keys(LAB).reduce((s, k) => s + n0(b[k]), 0) + (b.lignes || []).filter(l => l.t === 'gain').reduce((s, l) => s + n0(l.m), 0);
  const ret = b => n0(b.abs) + (b.lignes || []).filter(l => l.t === 'ret').reduce((s, l) => s + n0(l.m), 0);
  B.forEach((b, i) => {
    const m = b.periode, T = totauxMois(S.vacs, p, m, S.prefs.ratt), g = gains(b), r = ret(b), miss = (...a) => a.some(x => x == null);
    if (b.tib && b.quotite) add(m, 'na', `Salaire horaire indicatif : ${eur(b.tib / (151.67 * b.quotite / 100))} (traitement ÷ 151,67 h × quotité).`);
    if (b.brut == null) add(m, 'na', 'Total brut non saisi.');
    else add(m, Math.abs(g - r - b.brut) <= 1 ? 'ok' : 'err', `Gains ${eur(g)} − retenues sur brut ${eur(r)} = ${eur(g - r)} ; brut saisi ${eur(b.brut)}.`);
    if (miss(b.brut, b.cotis, b.csg, b.netAv)) add(m, 'na', 'Contrôle brut → net avant impôt impossible (données manquantes).');
    else { const e = b.brut - b.cotis - b.csg - b.netAv; add(m, Math.abs(e) <= 1 ? 'ok' : 'warn', `Brut − cotisations − CSG/CRDS = ${eur(b.brut - b.cotis - b.csg)} ; net avant impôt saisi ${eur(b.netAv)} (écart ${eur(e)}). Peut venir de rubriques non soumises : à vérifier.`); }
    if (miss(b.netAv, b.pas, b.net)) add(m, 'na', 'Contrôle net avant impôt − PAS = net impossible (données manquantes).');
    else add(m, Math.abs(b.netAv - b.pas - b.net) <= 1 ? 'ok' : 'err', `Net avant impôt ${eur(b.netAv)} − PAS ${eur(b.pas)} = ${eur(b.netAv - b.pas)} ; net saisi ${eur(b.net)}.`);
    if (b.pas != null) {
      if (b.pas > 0 && p.pas === 'non') add(m, 'warn', 'PAS prélevé alors que le profil indique « non » : à vérifier (résidence fiscale belge).');
      if (b.pas === 0 && p.pas === 'oui') add(m, 'warn', 'Aucun PAS alors que le profil indique « oui » : à vérifier.');
    }
    if (b.hp == null) add(m, 'na', 'Heures rémunérées non saisies : écart avec les vacations non calculable.');
    else add(m, Math.abs(T.min / 60 - b.hp) <= 0.5 ? 'ok' : 'warn', `Vacations saisies : ${hh(T.min)} ; heures rémunérées : ${b.hp} h.`);
    const nn = T.nuit > 0, pn = n0(b.nuit) > 0;
    if (nn || pn) add(m, nn !== pn ? 'warn' : 'ok', `Nuit : ${hh(T.nuit)} saisies ; majorations ${eur(n0(b.nuit))}.` + (nn !== pn ? TX : ''));
    const due = T.dim.size + T.fer.size > 0, pay = n0(b.dimf) > 0;
    if (due || pay) add(m, due !== pay ? 'warn' : 'ok', `${T.dim.size} dimanche(s) et ${T.fer.size} jour(s) férié(s) travaillés ; indemnités ${eur(n0(b.dimf))}.` + (due !== pay ? TX : ''));
    const pk = m.slice(5) === '01' ? null : m.slice(0, 5) + pad(+m.slice(5) - 1), pb = pk && B.find(x => x.periode === pk);
    if (miss(b.cumB, b.brut)) add(m, 'na', 'Cumul brut non vérifiable (donnée manquante).');
    else if (m.slice(5) === '01') add(m, Math.abs(b.cumB - b.brut) <= 1 ? 'ok' : 'err', `Janvier : cumul brut ${eur(b.cumB)} vs brut ${eur(b.brut)}.`);
    else if (pb && pb.cumB != null) { const e = b.cumB - pb.cumB - b.brut; add(m, Math.abs(e) <= 1 ? 'ok' : 'err', `Cumul ${eur(b.cumB)} − cumul précédent ${eur(pb.cumB)} − brut ${eur(b.brut)} = écart ${eur(e)}.`); }
    else add(m, 'na', 'Cumul brut non vérifiable : bulletin du mois précédent absent.');
    const q = B[i - 1];
    if (q) for (const k in LAB) { const a = n0(q[k]), c = n0(b[k]); if (a > 0 && Math.abs(c - a) / a > 0.3) add(m, 'warn', `${LAB[k]} : ${eur(a)} (${q.periode}) → ${eur(c)} : variation brutale sans explication saisie.`); }
  });
  const mv = {};
  for (const v of S.vacs) { if (v.nat !== 'travail') continue; const js = joursVac(v, p, v.ratt || S.prefs.ratt); if (!js) continue; const m = js[0].date.slice(0, 7); mv[m] = (mv[m] || 0) + 1; }
  for (const m in mv) if (!S.buls.some(b => b.periode === m)) add(m, 'na', `${mv[m]} vacation(s) sans bulletin pour ce mois (selon le décalage de paie, un autre bulletin peut les couvrir).`);
  chevauchements(S.vacs).forEach(([a, b]) => { const x = S.vacs.find(v => v.id === a), y = S.vacs.find(v => v.id === b); add(x.debut.slice(0, 7), 'warn', `Chevauchement ou doublon : ${aff(x)} et ${aff(y)}.`); });
  return R;
}

/* ---------- Génération du prompt (pure) ---------- */
const RATL = { debut: 'date de début', fin: 'date de fin', calendaire: 'répartition par jour calendaire' };
function construirePrompt(S) {
  const p = S.profil, tab = (h, rows) => '| ' + h.join(' | ') + ' |\n|' + h.map(() => '---').join('|') + '|\n' + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
  const B = [...S.buls].sort((a, b) => a.periode < b.periode ? -1 : 1), C = controles(S), V = [...S.vacs].sort((a, b) => a.debut < b.debut ? -1 : 1);
  const L2 = { ...LAB, abs: 'Absences et retenues' };
  const mois = [...new Set(V.flatMap(v => (joursVac(v, p, v.ratt || S.prefs.ratt) || []).map(j => j.date.slice(0, 7))))].sort();
  const nv = { ok: 'COHÉRENT', warn: 'À VÉRIFIER', err: 'ANOMALIE ARITHMÉTIQUE PROBABLE', na: 'INFO MANQUANTE' };
  return [
    '# RÔLE\nTu es analyste de bulletins de paie de la fonction publique hospitalière (FPH) française. Tu expliques et tu vérifies ; tu ne tranches pas.',
    `# PROFIL\n- Infirmier DE, FPH ; statut : ${p.statut || '?'} ; grade : ${p.grade || '?'} ; quotité : ${p.quotite ?? '?'} %\n- Résidence fiscale : Belgique ; travail en France ; prélèvement à la source français : ${p.pas}\n- Vacations de ${p.vacStd || 12} h (jour/nuit) ; plage de nuit : ${p.nuitDebut} h–${p.nuitFin} h ; cycle : ${p.cycle || '?'} ; temps contractuel : ${p.tempsContrat || '?'}\n- Accord/convention : ${p.accord || 'inconnu'} ; règles locales : ${p.regles || 'inconnues'}`,
    '# CONFIDENTIALITÉ\nLes documents sont anonymisés (nom, NIR, RIB, SIRET, URSSAF, APE, établissement, UF masqués). Ne demande aucune donnée personnelle.',
    '# RÈGLES\n- N’invente aucune donnée, aucun taux, aucune règle, aucune conclusion.\n- Cite systématiquement la période, la rubrique et le montant concernés.\n- Distingue : faits extraits des documents / calculs vérifiables / hypothèses / informations manquantes / règles dépendant de l’établissement ou de la convention.',
    '# BULLETINS (données saisies)\n' + tab(['Période', 'Paiement', 'Brut', 'Cotisations', 'CSG/CRDS', 'PAS', 'Net avant impôt', 'Net à payer', 'Net social', 'Cumul brut', 'Heures rémun.'],
      B.map(b => [b.periode, b.datePaie || '?', eur(b.brut), eur(b.cotis), eur(b.csg), eur(b.pas), eur(b.netAv), eur(b.net), eur(b.netSoc), eur(b.cumB), b.hp ?? '?'])),
    '# RUBRIQUES\n' + tab(['Période', 'Rubrique', 'Montant'], B.flatMap(b => Object.keys(L2).filter(k => b[k] != null).map(k => [b.periode, L2[k], eur(b[k])])
      .concat((b.lignes || []).map(l => [b.periode, `${l.l} (${l.t === 'gain' ? 'gain' : 'retenue'})`, eur(num(l.m))])))),
    `# VACATIONS (règle de rattachement par défaut : ${RATL[S.prefs.ratt]})\n` + tab(['Début', 'Fin', 'Nature', 'Rattachement', 'Détail par jour calendaire'],
      V.map(v => [v.debut.replace('T', ' '), v.fin.replace('T', ' '), v.nat, RATL[v.ratt || S.prefs.ratt], (joursVac(v, p, v.ratt || S.prefs.ratt) || []).map(j => `${j.date} : ${hh(j.min)} dont ${hh(j.nuit)} nuit${j.dim ? ' (dimanche)' : ''}${j.fer ? ' (férié)' : ''}`).join(' ; ')])),
    '# DÉCOMPTE MENSUEL\n' + tab(['Mois', 'Vacations 12 h', 'Heures', 'Heures de nuit', 'Dimanches', 'Jours fériés'], mois.map(m => { const t = totauxMois(V, p, m, S.prefs.ratt); return [m, t.n12, hh(t.min), hh(t.nuit), t.dim.size, t.fer.size]; })),
    '# CONTRÔLES DÉJÀ RÉALISÉS PAR L’APPLICATION (à vérifier, pas à croire)\n' + (C.map(c => `- [${nv[c.niv]}] ${c.mois} — ${c.txt}`).join('\n') || 'Aucun.'),
    '# TÂCHES\n1. Explique de façon pédagogique chaque rubrique.\n2. Vérifie les calculs arithmétiques (brut, retenues, net, cumuls).\n3. Détecte les anomalies et rubriques inhabituelles.\n4. Confronte vacations, nuits, dimanches et fériés aux rubriques payées.\n5. Rédige les questions précises à poser au service paie.\n6. Signale les points fiscaux franco-belges à vérifier, sans conclusion définitive.\n\n# FORMAT\nRéponds en tableaux Markdown. Sépare : Faits / Calculs vérifiables / Hypothèses / Informations manquantes / Règles dépendant de l’établissement. Cite période, rubrique et montant à chaque point.'
  ].join('\n\n');
}

/* ---------- 2. STOCKAGE LOCAL ---------- */
const KEY = 'paieFPH.v1';
const defaut = () => ({ v: 1, profil: { statut: 'titulaire', nuitDebut: 21, nuitFin: 6, vacStd: 12, pas: 'verifier' }, vacs: [], buls: [], anon: false, prefs: { ratt: 'calendaire' }, mois: new Date().toISOString().slice(0, 7) });
const charger = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); return d ? Object.assign(defaut(), d) : defaut(); } catch (e) { return defaut(); } };
let S = charger();
const sauver = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Enregistrement local impossible : ' + e.message); } };
const ED = {};   // brouillons d'édition (non persistés)

/* ---------- 3. INTERFACE ---------- */
const $ = s => document.querySelector(s), val = id => $('#' + id)?.value ?? '';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const champ = (id, lab, t, v) => `<label>${lab}<input id="${id}" type="${t === 'n' ? 'text' : t || 'text'}" ${t === 'n' ? 'inputmode="decimal"' : ''} value="${esc(v)}"></label>`;
const sel = (id, lab, opts, v) => `<label>${lab}<select id="${id}">${opts.map(o => { const [k, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${k}"${k == v ? ' selected' : ''}>${t}</option>`; }).join('')}</select></label>`;

const AVERT = ['Cet outil est une aide au contrôle. Il ne remplace pas le service paie, la DRH, les représentants du personnel ou un conseil fiscal compétent.', 'Vérifiez que vos documents sont anonymisés avant de les transmettre à une IA.', 'Les données restent sur cet appareil et peuvent être effacées si l’application est supprimée ou si l’espace de stockage est libéré. Exportez régulièrement vos données.', 'Cette application ne donne pas de conseil fiscal, social ou juridique définitif.'];
const TABS = [['accueil', 'Accueil', '🏠'], ['vacs', 'Vacations', '🕐'], ['buls', 'Bulletins', '🧾'], ['ctrl', 'Contrôles', '✅'], ['anon', 'Anonym.', '🔒'], ['prompt', 'Prompt', '💬'], ['export', 'Export', '📤']];
const NAT = { travail: 'Travail', conge: 'Congé', absence: 'Absence', formation: 'Formation', recup: 'Récupération' };
const RATO = [['debut', 'Date de début'], ['fin', 'Date de fin'], ['calendaire', 'Répartition par jour calendaire']];
const PF = [['grade', 'Grade / catégorie / échelon'], ['quotite', 'Quotité de travail (%)', 'n'], ['service', 'Service / pôle (ex. SERVICE-A)'], ['uf', 'UF d’affectation (ex. UF-A)'], ['tempsContrat', 'Temps de travail contractuel'], ['cycle', 'Cycle horaire habituel'], ['vacStd', 'Vacation standard (h)', 'n'], ['debJour', 'Début habituel vacation de jour', 'time'], ['debNuit', 'Début habituel vacation de nuit', 'time'], ['nuitDebut', 'Début de la plage de nuit (h)', 'n'], ['nuitFin', 'Fin de la plage de nuit (h)', 'n'], ['accord', 'Convention / accord d’établissement']];
const BF = [['periode', 'Période de paie', 'month'], ['datePaie', 'Date de paiement', 'date'], ['grade', 'Grade / catégorie / échelon', 'text'], ['quotite', 'Quotité (%)'], ['tib', 'Traitement indiciaire brut'], ['ir', 'Indemnité de résidence'], ['segur', 'Ségur / complément de traitement indiciaire'], ['suj', 'Indemnité de sujétion'], ['hs', 'Heures supplémentaires / complémentaires'], ['nuit', 'Majorations / indemnités de nuit'], ['dimf', 'Indemnités dimanche / jours fériés'], ['primes', 'Primes diverses'], ['abs', 'Absences et retenues'], ['brut', 'Total brut'], ['cotis', 'Cotisations salariales'], ['csg', 'CSG / CRDS'], ['pas', 'Prélèvement à la source'], ['netAv', 'Net à payer avant impôt'], ['net', 'Net à payer'], ['netSoc', 'Net social'], ['cumB', 'Cumul brut depuis janvier'], ['cumN', 'Cumul net depuis janvier'], ['hp', 'Heures rémunérées (h)']];
const ANON = [['Nom / prénom', '[ANONYMISÉ]'], ['Adresse', '[MASQUÉ]'], ['Numéro de Sécurité sociale / NIR', '[MASQUÉ]'], ['Matricule', '[MASQUÉ]'], ['RIB', '[MASQUÉ]'], ['Date de naissance', '[MASQUÉ]'], ['Coordonnées employeur', '[MASQUÉ]'], ['Informations familiales', '[MASQUÉ]'], ['Motifs d’absence / arrêt maladie', '[MASQUÉ]'], ['Logo de l’établissement', '[MASQUÉ]'], ['Nom de l’établissement', '[MASQUÉ] ou ÉTABLISSEMENT-01'], ['Adresse de l’établissement', '[MASQUÉ]'], ['SIRET', '[MASQUÉ]'], ['Numéro URSSAF', '[MASQUÉ]'], ['Code APE', '[MASQUÉ]'], ['UF d’affectation', 'UF-A, UF-B…'], ['Nom du service', 'SERVICE-A, SERVICE-B…'], ['Responsable / cadre', '[ANONYMISÉ]'], ['Signature ou cachet', '[MASQUÉ]']];

const VUES = {
  accueil() {
    const T = totauxMois(S.vacs, S.profil, S.mois, S.prefs.ratt), A = controles(S).filter(c => c.mois === S.mois && (c.niv === 'warn' || c.niv === 'err')).length;
    const g = [[T.n12, 'vacations de 12 h'], [hh(T.min), 'heures totales'], [hh(T.nuit), 'heures de nuit'], [T.dim.size, 'dimanches'], [T.fer.size, 'jours fériés'], [A, 'anomalies']];
    return `<h1>Analyse de fiches de paie — infirmier FPH</h1><p class="sub">Vacations de 12 h, nuits, week-ends, jours fériés et contrôle de paie</p>
<div class="avert">${AVERT.map(a => `<p>⚠️ ${a}</p>`).join('')}</div>
<button data-a="go" data-i="vacs">Ajouter une vacation</button><button data-a="go" data-i="buls">Ajouter un bulletin</button><button data-a="go" data-i="prompt">Générer le prompt Claude</button><button class="sec" data-a="go" data-i="profil">Profil professionnel</button>
${champ('mois', 'Mois sélectionné', 'month', S.mois)}<div class="grille">${g.map(([v, l]) => `<div class="card"><b>${v}</b>${l}</div>`).join('')}</div>`;
  },
  profil() {
    const p = S.profil;
    return `<h1>Profil professionnel</h1>${sel('p_statut', 'Statut', ['titulaire', 'contractuel', 'autre'], p.statut)}${PF.map(([k, l, t]) => champ('p_' + k, l, t, p[k])).join('')}
<label>Règles locales connues<textarea id="p_regles" style="min-height:90px">${esc(p.regles)}</textarea></label>${sel('p_pas', 'Prélèvement à la source français appliqué', [['oui', 'Oui'], ['non', 'Non'], ['verifier', 'À vérifier']], p.pas)}
<p>Résidence fiscale : Belgique · Pays d’exercice : France</p><button data-a="savePro">Enregistrer</button>`;
  },
  vacs() {
    const e = ED.v || {}, bd = (s, i) => s ? s.slice(i ? 11 : 0, i ? 16 : 10) : '', ch = new Set(chevauchements(S.vacs).flat());
    return `<h1>Vacations</h1>${sel('rattDef', 'Règle de rattachement par défaut (vacation à cheval sur 2 jours)', RATO, S.prefs.ratt)}
<div class="card"><h2>${e.id ? 'Modifier' : 'Ajouter'} une vacation</h2>${champ('vdD', 'Date de début', 'date', bd(e.debut))}${champ('vdH', 'Heure de début', 'time', bd(e.debut, 1))}${champ('vfD', 'Date de fin', 'date', bd(e.fin))}${champ('vfH', 'Heure de fin', 'time', bd(e.fin, 1))}
${sel('vn', 'Nature', Object.entries(NAT), e.nat || 'travail')}${sel('vr', 'Rattachement', [['', 'Règle par défaut'], ...RATO], e.ratt || '')}${sel('vdi', 'Dimanche travaillé', [['auto', 'Auto'], ['oui', 'Oui'], ['non', 'Non']], e.dim || 'auto')}${sel('vfe', 'Jour férié travaillé', [['auto', 'Auto'], ['oui', 'Oui'], ['non', 'Non']], e.fer || 'auto')}${champ('vc', 'Commentaire (facultatif)', 'text', e.comm)}
<button data-a="saveVac">Enregistrer la vacation</button>${e.id ? '<button class="sec" data-a="annVac">Annuler</button>' : ''}</div>
${[...S.vacs].sort((a, b) => a.debut < b.debut ? 1 : -1).map(v => {
      const r = v.ratt || S.prefs.ratt, js = joursVac(v, S.profil, r) || [], mn = js.reduce((s, j) => s + j.min, 0), nu = js.reduce((s, j) => s + j.nuit, 0);
      return `<div class="card ${ch.has(v.id) ? 'warn' : ''}"><b>${aff(v)}</b><br><span class="tag">${NAT[v.nat]}</span><span class="tag">${nu === 0 ? 'jour' : nu === mn ? 'nuit' : 'mixte'}</span><span class="tag">${hh(mn)}</span><span class="tag">nuit ${hh(nu)}</span><span class="tag">rattachement : ${RATL[r]}</span>${v.debut.slice(0, 10) !== v.fin.slice(0, 10) ? '<span class="tag">2 jours calendaires</span>' : ''}${ch.has(v.id) ? '<span class="tag">⚠ chevauchement</span>' : ''}<br>${js.map(j => `${j.date} : ${hh(j.min)} (nuit ${hh(j.nuit)})${j.dim ? ' · dimanche' : ''}${j.fer ? ' · férié' : ''}`).join('<br>')}${v.comm ? '<br><i>' + esc(v.comm) + '</i>' : ''}<br><button class="pt sec" data-a="editVac" data-i="${v.id}">Modifier</button><button class="pt dg" data-a="delVac" data-i="${v.id}">Supprimer</button></div>`;
    }).join('') || '<p>Aucune vacation saisie.</p>'}`;
  },
  buls() {
    const e = ED.b || { lignes: [] };
    return `<h1>Bulletins de paie</h1><div class="card"><h2>${ED.b?.saved ? 'Modifier' : 'Ajouter'} un bulletin</h2>${BF.map(([k, l, t]) => champ('b_' + k, l, t || 'n', e[k])).join('')}<h2>Rubriques personnalisées</h2>
${(e.lignes || []).map((l, i) => `<div class="card">${champ('ll' + i, 'Libellé', 'text', l.l)}${champ('lm' + i, 'Montant', 'n', l.m)}${sel('lt' + i, 'Type', [['gain', 'Gain'], ['ret', 'Retenue sur brut']], l.t)}<button class="pt dg" data-a="delLigne" data-i="${i}">Supprimer la ligne</button></div>`).join('')}
<button class="sec" data-a="addLigne">+ Ajouter une rubrique</button><button data-a="saveBul">Enregistrer le bulletin</button>${ED.b ? '<button class="sec" data-a="annBul">Annuler</button>' : ''}</div>
${[...S.buls].sort((a, b) => a.periode < b.periode ? 1 : -1).map(b => `<div class="card"><b>${b.periode}</b> — brut ${eur(b.brut)} · net ${eur(b.net)} · ${(b.lignes || []).length} rubrique(s) perso<br><button class="pt sec" data-a="editBul" data-i="${b.id}">Modifier</button><button class="pt dg" data-a="delBul" data-i="${b.id}">Supprimer</button></div>`).join('') || '<p>Aucun bulletin saisi.</p>'}`;
  },
  ctrl() {
    const C = controles(S), ms = [...new Set(C.map(c => c.mois))].sort().reverse();
    return `<h1>Contrôles automatiques</h1><p><span class="tag">vert : cohérent</span><span class="tag">orange : à vérifier</span><span class="tag">rouge : anomalie arithmétique probable</span><span class="tag">gris : information manquante</span></p>
${ms.map(m => `<h2>${m}</h2>${C.filter(c => c.mois === m).map(c => `<div class="card ${c.niv}">${esc(c.txt)}</div>`).join('')}`).join('') || '<p>Saisissez des bulletins et des vacations pour lancer les contrôles.</p>'}`;
  },
  anon() {
    return `<h1>Anonymisation</h1><div class="avert"><p>Masquez ces éléments sur vos PDF/images (outil de retouche de l’iPhone ou de l’ordinateur) avant toute transmission à une IA.</p></div>
<label>Ajouter des documents (aperçu local uniquement, rien n’est stocké ni envoyé)<input id="fichiers" type="file" multiple accept="application/pdf,image/*"></label><div id="apercu"></div>
${ANON.map(([a, b]) => `<div class="card"><b>${a}</b><br>Remplacer par : ${b}</div>`).join('')}
<label><input type="checkbox" id="anon" ${S.anon ? 'checked' : ''}>Je confirme avoir masqué les données personnelles sensibles, le NIR, le RIB, le SIRET, le numéro URSSAF, le code APE, le logo, le nom de l’établissement et l’UF d’affectation avant toute transmission à une IA.</label>`;
  },
  prompt() {
    if (!S.anon) return `<h1>Prompt Claude</h1><div class="card err">Génération refusée : confirmez d’abord l’anonymisation (case obligatoire).</div><button data-a="go" data-i="anon">Aller à l’anonymisation</button>`;
    return `<h1>Prompt Claude</h1><p>Rien n’est envoyé automatiquement : copiez, puis collez dans Claude.</p><button data-a="copier">Copier le prompt</button><textarea id="pr" readonly>${esc(construirePrompt(S))}</textarea>`;
  },
  export() {
    return `<h1>Export et sauvegarde</h1><button data-a="exp" data-i="suivi">Tableau de suivi (CSV)</button><button data-a="exp" data-i="plan">Planning des vacations (CSV)</button><button data-a="exp" data-i="md">Rapport d’anomalies (Markdown)</button><button data-a="exp" data-i="json">Toutes les données (JSON)</button>
<label>Importer un JSON exporté<input id="imp" type="file" accept="application/json,.json"></label><button class="dg" data-a="clear">Effacer toutes les données locales</button>`;
  }
};

const route = () => location.hash.slice(1) || 'accueil';
function render() {
  const r = route();
  $('#vue').innerHTML = (VUES[r] || VUES.accueil)();
  $('#tabs').innerHTML = TABS.map(([k, l, i]) => `<a href="#${k}" class="${k === r ? 'on' : ''}"><b>${i}</b>${l}</a>`).join('');
}
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

/* ---------- Actions ---------- */
const lireBul = () => {
  const b = { id: ED.b?.id || uid(), saved: ED.b?.saved, lignes: [] };
  BF.forEach(([k, , t = 'n']) => { b[k] = t === 'n' ? num(val('b_' + k)) : val('b_' + k); });
  (ED.b?.lignes || []).forEach((_, i) => b.lignes.push({ l: val('ll' + i), m: num(val('lm' + i)), t: val('lt' + i) }));
  return b;
};
const ACT = {
  go: i => { location.hash = i; },
  savePro() {
    const p = S.profil; p.statut = val('p_statut'); p.pas = val('p_pas'); p.regles = val('p_regles');
    PF.forEach(([k, , t]) => { const v = val('p_' + k); p[k] = t === 'n' ? num(v) : v; });
    for (const k of ['nuitDebut', 'nuitFin']) if (p[k] == null || p[k] < 0 || p[k] > 24) p[k] = k === 'nuitDebut' ? 21 : 6;
    sauver(); alert('Profil enregistré.'); location.hash = 'accueil';
  },
  saveVac() {
    const d = val('vdD') + 'T' + val('vdH'), f = val('vfD') + 'T' + val('vfH'), a = new Date(d), b = new Date(f);
    if (isNaN(a) || isNaN(b)) return alert('Dates et heures de début et de fin obligatoires.');
    if (b <= a) return alert('La fin doit être postérieure au début.');
    if (b - a > 864e5) return alert('Durée supérieure à 24 h : vérifiez les dates.');
    const v = { id: ED.v?.id || uid(), debut: d, fin: f, nat: val('vn'), ratt: val('vr'), dim: val('vdi'), fer: val('vfe'), comm: val('vc') };
    const i = S.vacs.findIndex(x => x.id === v.id); i < 0 ? S.vacs.push(v) : S.vacs[i] = v;
    ED.v = null; sauver(); render();
  },
  editVac: i => { ED.v = S.vacs.find(v => v.id === i); render(); scrollTo(0, 0); },
  annVac: () => { ED.v = null; render(); },
  delVac: i => { if (confirm('Supprimer cette vacation ?')) { S.vacs = S.vacs.filter(v => v.id !== i); sauver(); render(); } },
  addLigne: () => { ED.b = lireBul(); ED.b.lignes.push({ l: '', m: null, t: 'gain' }); render(); },
  delLigne: i => { ED.b = lireBul(); ED.b.lignes.splice(+i, 1); render(); },
  saveBul() {
    const b = lireBul(); if (!/^\d{4}-\d{2}$/.test(b.periode)) return alert('Période de paie obligatoire.');
    if (S.buls.some(x => x.periode === b.periode && x.id !== b.id) && !confirm('Un bulletin existe déjà pour cette période. Enregistrer quand même ?')) return;
    b.saved = true; const i = S.buls.findIndex(x => x.id === b.id); i < 0 ? S.buls.push(b) : S.buls[i] = b;
    ED.b = null; sauver(); render();
  },
  editBul: i => { ED.b = JSON.parse(JSON.stringify(S.buls.find(b => b.id === i))); render(); scrollTo(0, 0); },
  annBul: () => { ED.b = null; render(); },
  delBul: i => { if (confirm('Supprimer ce bulletin ?')) { S.buls = S.buls.filter(b => b.id !== i); sauver(); render(); } },
  async copier() {
    const t = $('#pr');
    try { await navigator.clipboard.writeText(t.value); } catch (e) { t.select(); t.setSelectionRange(0, 1e6); document.execCommand('copy'); }
    alert('Prompt copié.');
  },
  exp(i) {
    const d = new Date().toISOString().slice(0, 10);
    const X = { suivi: [`suivi-paie-${d}.csv`, csvSuivi(S), 'text/csv'], plan: [`vacations-${d}.csv`, csvPlanning(S), 'text/csv'], md: [`anomalies-${d}.md`, rapportMd(S), 'text/markdown'], json: [`sauvegarde-paie-${d}.json`, JSON.stringify(S, null, 1), 'application/json'] }[i];
    donner(...X);
  },
  clear() { if (confirm('Effacer TOUTES les données locales ?') && confirm('Dernière confirmation : cette action est irréversible.')) { localStorage.removeItem(KEY); S = defaut(); render(); alert('Données effacées.'); } }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) ACT[b.dataset.a]?.(b.dataset.i); });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'mois') { S.mois = t.value || S.mois; sauver(); render(); }
  else if (t.id === 'rattDef') { S.prefs.ratt = t.value; sauver(); render(); }
  else if (t.id === 'anon') { S.anon = t.checked; sauver(); }
  else if (t.id === 'fichiers') $('#apercu').innerHTML = [...t.files].map(f => f.type.startsWith('image/') ? `<img class="mini" src="${URL.createObjectURL(f)}" alt="">` : `<p>📄 ${esc(f.name)}</p>`).join('');
  else if (t.id === 'imp') importer(t.files[0]);
});

/* ---------- 4. EXPORT ---------- */
const csv = rows => '\uFEFF' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
function csvSuivi(S) {
  return csv([['Période', 'Paiement', ...BF.slice(4).map(b => b[1]), 'Vacations (h)', 'Nuit (h)', 'Dimanches', 'Fériés'],
    ...[...S.buls].sort((a, b) => a.periode < b.periode ? -1 : 1).map(b => { const t = totauxMois(S.vacs, S.profil, b.periode, S.prefs.ratt); return [b.periode, b.datePaie, ...BF.slice(4).map(([k]) => b[k]), t.min / 60, t.nuit / 60, t.dim.size, t.fer.size]; })]);
}
function csvPlanning(S) {
  return csv([['Début', 'Fin', 'Nature', 'Rattachement', 'Durée (h)', 'Nuit (h)', 'Détail par jour', 'Commentaire'],
    ...S.vacs.map(v => { const r = v.ratt || S.prefs.ratt, js = joursVac(v, S.profil, r) || []; return [v.debut, v.fin, NAT[v.nat], RATL[r], js.reduce((s, j) => s + j.min, 0) / 60, js.reduce((s, j) => s + j.nuit, 0) / 60, js.map(j => `${j.date}:${hh(j.min)}${j.dim ? ' dim' : ''}${j.fer ? ' fér' : ''}`).join(' | '), v.comm]; })]);
}
const rapportMd = S => '# Rapport d’anomalies\n\n> Aide au contrôle, sans valeur de conseil fiscal, social ou juridique.\n\n' + (controles(S).map(c => `- **${{ ok: 'vert', warn: 'orange', err: 'rouge', na: 'gris' }[c.niv]}** ${c.mois} — ${c.txt}`).join('\n') || 'Aucun contrôle.');
// Partage iOS si disponible, sinon téléchargement. Aucune donnée n'est envoyée automatiquement.
async function donner(nom, txt, mime) {
  const f = new File([txt], nom, { type: mime });
  try { if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: nom }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
}
async function importer(f) {
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.vacs) || !Array.isArray(d.buls)) throw Error('fichier non reconnu');
    if (!confirm('Remplacer toutes les données locales par ce fichier ?')) return;
    S = Object.assign(defaut(), d); sauver(); render(); alert('Import terminé.');
  } catch (e) { alert('Import impossible : ' + e.message); }
}

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
render();

/* ---------- TESTS MANUELS ----------
 1. Profil : plage de nuit 21–6. Vacation sam. 19:00 → dim. 07:00, règle « calendaire » :
    attendu sam. 5 h (nuit 3 h), dim. 7 h (nuit 6 h), total 12 h, nuit 9 h, 1 dimanche.
 2. Même vacation en « début » : 12 h le samedi, 0 dimanche ; en « fin » : 12 h le dimanche, 1 dimanche.
 3. Saisir 2 vacations qui se recouvrent : carte orange + contrôle « chevauchement ».
 4. Bulletin avec brut ≠ gains − retenues : contrôle rouge. Nuit saisie sans majoration : orange avec mention « règles dépendantes ».
 5. Cumul janvier ≠ brut, ou cumul mois N ≠ cumul N-1 + brut : rouge.
 6. Prompt : refusé tant que la case d’anonymisation n’est pas cochée.
 7. Mode avion + app installée : l’app s’ouvre et fonctionne ; export JSON puis import : données identiques.
 8. 1er mai / 25 déc. travaillés : détectés comme fériés ; « Non » dans le forçage les exclut.
*/

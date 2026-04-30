import { SYMPTOMS, CLUSTERS, TOTAL_MAX, CLUSTER_HEADLINES, CLUSTER_RECOMMENDATIONS } from './data.js';

export let lastResult = null;

export function computeScore(answers) {
  let score = 0;
  const contributions = [];

  for (const symptom of SYMPTOMS) {
    const val = answers[symptom.key] === true ? 1 : 0;
    const contrib = val * symptom.corr;
    score += contrib;
    contributions.push({ ...symptom, value: val, contribution: contrib });
  }

  const cluster = CLUSTERS.find(c => score >= c.range[0] && score <= c.range[1])
    || CLUSTERS[CLUSTERS.length - 1];

  const topFactors = contributions
    .filter(c => c.value === 1)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const positiveCount = contributions.filter(c => c.value === 1).length;
  const pctOfMax = ((score / TOTAL_MAX) * 100).toFixed(1);

  lastResult = { score, cluster, topFactors, positiveCount, pctOfMax, contributions, answers };
  return lastResult;
}

function buildInterpretation(result) {
  const { score, cluster, topFactors, positiveCount, pctOfMax } = result;

  const topNames = topFactors.map(f => f.label);
  const topStr = topNames.length
    ? topNames.join(', ')
    : 'none';

  const driverSentence = topFactors.length
    ? `The principal contributors to this score are <strong>${topStr}</strong>, which collectively carry the highest correlation weights in the instrument.`
    : `No high-weight symptoms were reported.`;

  const absenceSentence = positiveCount === 0
    ? `The absence of reported symptoms across all 25 indicators yields a near-zero score, consistent with a very low-probability profile.`
    : '';

  return `
    <p class="drop-cap">This patient reported <strong>${positiveCount}</strong> of 25 assessed symptoms,
    yielding a cumulative score of <strong>${score.toFixed(2)}</strong> — representing
    <strong>${pctOfMax}%</strong> of the theoretical maximum of ${TOTAL_MAX}.
    This places the patient in the <strong>${cluster.name}</strong> cluster (Cluster ${cluster.id} of 5).
    ${absenceSentence}</p>
    <p>Within the 200-patient reference cohort, <strong>${cluster.diagnosed_pct}%</strong> of patients
    stratified into this cluster received a confirmed endometriosis diagnosis via laparoscopy and
    histological analysis. ${driverSentence}</p>
    <p>The weight class most strongly represented in this assessment is the
    <strong>${topFactors.length ? topFactors[0].label : 'not applicable'}</strong> domain
    (correlation weight: ${topFactors.length ? topFactors[0].corr.toFixed(2) : 'N/A'}).
    Clinicians should consider this cluster designation in the context of the full clinical picture,
    including examination findings, imaging, and patient history.</p>
  `;
}

export function renderResult(result) {
  const { score, cluster, topFactors, positiveCount, pctOfMax } = result;
  const panel = document.getElementById('result-panel');
  const markerPct = Math.min((score / TOTAL_MAX) * 100, 100);

  panel.querySelector('.result-headline').textContent = CLUSTER_HEADLINES[cluster.id];

  // Score grid
  const scoreVal = panel.querySelector('.score-value');
  scoreVal.textContent = score.toFixed(2);
  scoreVal.style.color = cluster.color;
  panel.querySelector('.score-max').style.color = cluster.color;

  const clusterCell = panel.querySelector('.cluster-cell');
  clusterCell.querySelector('.cluster-name').textContent = cluster.name;
  clusterCell.querySelector('.cluster-label').textContent = `Cluster ${cluster.id} of 5`;
  clusterCell.style.borderColor = cluster.color;
  clusterCell.querySelector('.cluster-swatch').style.background = cluster.color;

  // Gauge marker
  const marker = panel.querySelector('.gauge-marker');
  marker.style.transition = 'none';
  marker.style.left = '0%';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      marker.style.transition = 'left 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)';
      marker.style.left = `${markerPct}%`;
    });
  });

  // Interpretation
  panel.querySelector('.interpretation-body').innerHTML = buildInterpretation(result);

  // Top factors
  const factorsList = panel.querySelector('.factors-list');
  factorsList.innerHTML = '';
  const numerals = ['№1', '№2', '№3'];
  topFactors.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'factor-item';
    li.innerHTML = `
      <span class="factor-rank">${numerals[i]}</span>
      <span class="factor-body">
        <span class="factor-label">${f.label}</span>
        <span class="factor-sub">${f.sub}</span>
      </span>
      <span class="factor-contrib">+${f.contribution.toFixed(2)}</span>
    `;
    factorsList.appendChild(li);
  });

  if (topFactors.length === 0) {
    factorsList.innerHTML = '<li class="factor-item factor-none">No positive symptoms reported.</li>';
  }

  // Recommendation
  panel.querySelector('.recommendation-text').innerHTML = CLUSTER_RECOMMENDATIONS[cluster.id];

  // Stamp cluster color
  panel.querySelector('.stamp-tab').style.background = cluster.color;

  // Show panel
  panel.hidden = false;
  panel.style.opacity = '0';
  panel.style.transform = 'translateY(20px)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      panel.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      panel.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
    });
  });

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

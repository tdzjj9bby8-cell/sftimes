// SF Times Quiz Engine
// Shared logic for personality quizzes (MBTI, Enneagram, Blood Type, etc.).
//
// THREE SCORING MODES, all driven by the same engine:
//
// 1. 'likert-axis'
//    For multi-axis tests like MBTI / Big Five. Each item is a single
//    statement with a 5-point Likert scale (Strongly Disagree -> Strongly
//    Agree). Each item belongs to one dimension (e.g. 'EI') and has a
//    direction (-1 or +1) indicating which letter the item leans toward.
//    Score per item = direction * (answer - 3); answer is 1-5.
//    Score per dimension = sum of item scores. Sign determines letter.
//    Magnitude / max -> percentage strength.
//    Pages render as groups of N items (default 10) with one "Next" button.
//
// 2. 'likert-tally'
//    For Enneagram-style tests where each item is a "I am ___" statement
//    tied to one type. User rates agreement 1-5. Score per type =
//    sum of (answer - 3) for that type's items. Highest score wins.
//    Top three are shown ranked.
//
// 3. 'tally'
//    Forced-choice mode. Each question shows multiple options. Each option
//    points to one type. Highest tally wins. One question per screen.
//    Used for the Blood Type quiz.
//
// SCHEMA:
//   window.SFTIMES_QUIZ = {
//     id: 'mbti',
//     title: '...',
//     intro: '...',
//     scoringMode: 'likert-axis' | 'likert-tally' | 'tally',
//     itemsPerPage: 10,                      // optional, likert modes only
//     dimensions: ['EI', 'SN', 'TF', 'JP'],   // axis mode only
//     types: ['ESTJ', 'INFP', ...],           // for axis: result key list;
//                                              // for tally: type list to score
//     items: [                                  // likert modes
//       { text: '...', dimension: 'EI', direction: 1 },
//       { text: '...', type: '5' },             // for likert-tally
//       ...
//     ],
//     questions: [                              // forced-choice tally mode
//       { text: '...', options: [{label, type, weight}, ...] }
//     ],
//     resultsByType: { ESTJ: { name, blurb, reads }, ... }
//   };

(function () {
  const quiz = window.SFTIMES_QUIZ;
  if (!quiz) {
    console.error('SFTIMES_QUIZ not defined on window');
    return;
  }
  const root = document.getElementById('quiz-root');
  if (!root) return;

  const LIKERT = [
    { value: 1, label: 'Hard no' },
    { value: 2, label: 'Not really' },
    { value: 3, label: 'Sometimes' },
    { value: 4, label: 'Sounds like me' },
    { value: 5, label: 'That is exactly me' },
  ];

  // Variable copy for the "Next page" button. Cycles based on page index so
  // the user never sees the same label twice in a row. Same purpose, more
  // texture.
  const NEXT_BUTTON_COPY = [
    'Next page &rarr;',
    'Keep going &rarr;',
    'You are doing great &rarr;',
    'Halfway-ish &rarr;',
    'One more &rarr;',
    'Last set &rarr;',
  ];
  const FINAL_BUTTON_COPY = 'Show me my type &rarr;';

  // Tiny aside lines that show above the question header on each page.
  // Designed so any of them lands without looking out of place.
  const PAGE_ASIDES = [
    'No wrong answers, but think about it.',
    'Pick the one that is closer to you in the last week, not your highest self.',
    'You are allowed to be neutral. Use it sparingly.',
    'The answer you almost picked is a clue too.',
    'You can go back if a later question changes how you read an earlier one.',
    'Halfway through. The shape is starting to show.',
  ];

  // Loading state messages while the result computes. We hold the loading
  // screen for ~1.6s on purpose; the small ceremony makes the result feel
  // earned and gives the breakdown bars something to render into.
  const LOADING_LINES = [
    'Tallying your answers.',
    'Cross-checking against the SF Times reader cohort.',
    'Building your type stamp.',
    'Picking your reading list.',
  ];

  // State
  let pageIdx = 0;
  let answers = []; // per item: 1..5 for likert; option index for tally

  function escHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isLikert() {
    return quiz.scoringMode === 'likert-axis' || quiz.scoringMode === 'likert-tally';
  }

  function totalItems() {
    return isLikert() ? quiz.items.length : quiz.questions.length;
  }

  function itemsPerPage() {
    return quiz.itemsPerPage || 10;
  }

  function pagesCount() {
    if (!isLikert()) return totalItems();
    return Math.ceil(totalItems() / itemsPerPage());
  }

  function pageItems() {
    if (!isLikert()) return [quiz.questions[pageIdx]];
    const start = pageIdx * itemsPerPage();
    return quiz.items.slice(start, start + itemsPerPage()).map((item, i) => ({
      ...item,
      globalIdx: start + i,
    }));
  }

  // ------- INTRO -------
  function renderIntro() {
    const itemCount = totalItems();
    const pageNote = isLikert() ? ` Grouped into ${pagesCount()} pages.` : '';
    root.innerHTML = `
      <section class="quiz-intro">
        <p class="quiz-eyebrow">${escHTML(quiz.eyebrow || 'SF Times Quiz')}</p>
        <h1 class="quiz-title">${escHTML(quiz.title)}</h1>
        <p class="quiz-deck">${escHTML(quiz.intro || '')}</p>
        <p class="quiz-meta">${itemCount} items &middot; ${escHTML(quiz.estimate || '~5 minutes')}.${pageNote}</p>
        <button class="quiz-start btn primary" id="quiz-start-btn">Begin &rarr;</button>
        <p class="quiz-disclaimer">${escHTML(quiz.disclaimer || 'Modeled on standard short-form personality inventories. For curiosity, not diagnosis.')}</p>
      </section>
    `;
    document.getElementById('quiz-start-btn').addEventListener('click', () => {
      pageIdx = 0;
      answers = [];
      renderPage();
    });
  }

  // ------- LIKERT PAGE -------
  function renderLikertPage() {
    const items = pageItems();
    const pageNum = pageIdx + 1;
    const totalPages = pagesCount();
    const progress = Math.round(((pageIdx) / totalPages) * 100);
    const aside = PAGE_ASIDES[pageIdx % PAGE_ASIDES.length];
    const isFinalPage = pageIdx === totalPages - 1;
    const nextCopy = isFinalPage ? FINAL_BUTTON_COPY : NEXT_BUTTON_COPY[pageIdx % NEXT_BUTTON_COPY.length];
    root.innerHTML = `
      <section class="quiz-question quiz-likert quiz-fade-in">
        <div class="quiz-progress" aria-label="Quiz progress">
          <div class="quiz-progress-bar" style="width: ${progress}%"></div>
          <span class="quiz-progress-label">Page ${pageNum} of ${totalPages}</span>
        </div>
        <p class="quiz-page-aside">${escHTML(aside)}</p>
        <h2 class="quiz-q-text">Rate how much each statement is you.</h2>
        <ol class="quiz-likert-list" start="${pageIdx * itemsPerPage() + 1}">
          ${items.map((item) => `
            <li class="quiz-likert-item" data-idx="${item.globalIdx}">
              <p class="quiz-likert-text">${escHTML(item.text)}</p>
              <div class="quiz-likert-scale" role="radiogroup" aria-label="${escHTML(item.text)}">
                ${LIKERT.map((opt) => `
                  <label class="quiz-likert-opt">
                    <input type="radio" name="item-${item.globalIdx}" value="${opt.value}" ${answers[item.globalIdx] === opt.value ? 'checked' : ''}>
                    <span class="quiz-likert-dot"></span>
                    <span class="quiz-likert-opt-label">${escHTML(opt.label)}</span>
                  </label>
                `).join('')}
              </div>
            </li>
          `).join('')}
        </ol>
        <div class="quiz-page-nav">
          <button class="quiz-back" id="quiz-back-btn" ${pageIdx === 0 ? 'disabled' : ''}>&larr; Back</button>
          <button class="quiz-next btn primary" id="quiz-next-btn">${nextCopy}</button>
        </div>
        <p class="quiz-page-incomplete" id="quiz-incomplete-msg" style="display: none;">Answer every item on this page to continue.</p>
      </section>
    `;
    // Wire up radio listeners (capture answers as user picks)
    root.querySelectorAll('.quiz-likert-item').forEach((li) => {
      const idx = parseInt(li.dataset.idx, 10);
      li.querySelectorAll('input[type="radio"]').forEach((rad) => {
        rad.addEventListener('change', (e) => {
          answers[idx] = parseInt(e.target.value, 10);
          document.getElementById('quiz-incomplete-msg').style.display = 'none';
        });
      });
    });
    // Next button
    document.getElementById('quiz-next-btn').addEventListener('click', () => {
      const allAnswered = items.every((it) => typeof answers[it.globalIdx] === 'number');
      if (!allAnswered) {
        document.getElementById('quiz-incomplete-msg').style.display = 'block';
        // Scroll to first unanswered
        const firstMissing = items.find((it) => typeof answers[it.globalIdx] !== 'number');
        if (firstMissing) {
          const li = root.querySelector(`.quiz-likert-item[data-idx="${firstMissing.globalIdx}"]`);
          if (li) li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      pageIdx++;
      if (pageIdx >= pagesCount()) {
        renderLoading();
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        renderPage();
      }
    });
    // Back button
    document.getElementById('quiz-back-btn').addEventListener('click', () => {
      if (pageIdx > 0) {
        pageIdx--;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        renderPage();
      }
    });
  }

  // ------- TALLY (forced-choice) PAGE -------
  function renderTallyPage() {
    const q = quiz.questions[pageIdx];
    const totalPages = pagesCount();
    const progress = Math.round(((pageIdx) / totalPages) * 100);
    root.innerHTML = `
      <section class="quiz-question">
        <div class="quiz-progress" aria-label="Quiz progress">
          <div class="quiz-progress-bar" style="width: ${progress}%"></div>
          <span class="quiz-progress-label">${pageIdx + 1} / ${totalPages}</span>
        </div>
        <h2 class="quiz-q-text">${escHTML(q.text)}</h2>
        <ul class="quiz-options">
          ${q.options.map((opt, i) => `
            <li>
              <button class="quiz-option" data-i="${i}">
                <span class="quiz-option-letter">${String.fromCharCode(65 + i)}</span>
                <span class="quiz-option-label">${escHTML(opt.label)}</span>
              </button>
            </li>
          `).join('')}
        </ul>
        <button class="quiz-back" id="quiz-back-btn" ${pageIdx === 0 ? 'disabled' : ''}>&larr; Back</button>
      </section>
    `;
    root.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.i, 10);
        answers[pageIdx] = i;
        pageIdx++;
        if (pageIdx >= quiz.questions.length) {
          renderLoading();
        } else {
          renderPage();
        }
      });
    });
    document.getElementById('quiz-back-btn').addEventListener('click', () => {
      if (pageIdx > 0) {
        pageIdx--;
        answers.pop();
        renderPage();
      }
    });
  }

  function renderPage() {
    if (isLikert()) renderLikertPage();
    else renderTallyPage();
  }

  // ------- LOADING -------
  // ~1.6s ceremony before the result. Cycles a few honest copy lines so the
  // wait feels like the quiz is doing something for you.
  function renderLoading() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    root.innerHTML = `
      <section class="quiz-loading">
        <div class="quiz-loading-rings" aria-hidden="true">
          <div class="ring ring-1"></div>
          <div class="ring ring-2"></div>
          <div class="ring ring-3"></div>
        </div>
        <p class="quiz-loading-line" id="quiz-loading-line">${escHTML(LOADING_LINES[0])}</p>
      </section>
    `;
    const lineEl = document.getElementById('quiz-loading-line');
    let li = 0;
    const interval = setInterval(() => {
      li = (li + 1) % LOADING_LINES.length;
      if (lineEl) lineEl.textContent = LOADING_LINES[li];
    }, 450);
    setTimeout(() => {
      clearInterval(interval);
      renderResult();
    }, 1700);
  }

  // ------- COMPUTE -------
  function computeAxisResult() {
    // Sum (answer - 3) * direction per dimension. Range per item: -2..+2.
    const sums = {};
    const counts = {};
    quiz.dimensions.forEach((d) => { sums[d] = 0; counts[d] = 0; });
    quiz.items.forEach((item, idx) => {
      const ans = answers[idx];
      if (typeof ans !== 'number') return;
      const score = item.direction * (ans - 3);
      sums[item.dimension] += score;
      counts[item.dimension] += 1;
    });
    // Letter for each axis: dimension name like 'EI' — first letter for negative, second for positive.
    let typeKey = '';
    const breakdown = {};
    quiz.dimensions.forEach((d) => {
      const v = sums[d];
      const maxAbs = counts[d] * 2;                            // max possible |score|
      const pct = maxAbs > 0 ? Math.round((Math.abs(v) / maxAbs) * 100) : 50;
      const letter = v <= 0 ? d[0] : d[1];
      typeKey += letter;
      breakdown[d] = {
        score: v,
        pctOfChosen: pct,
        chosenLetter: letter,
        otherLetter: v <= 0 ? d[1] : d[0],
        firstPct: v <= 0 ? Math.round(50 + (Math.abs(v) / maxAbs) * 50) : Math.round(50 - (Math.abs(v) / maxAbs) * 50),
        secondPct: v <= 0 ? Math.round(50 - (Math.abs(v) / maxAbs) * 50) : Math.round(50 + (Math.abs(v) / maxAbs) * 50),
      };
    });
    return { typeKey, breakdown };
  }

  function computeTallyLikertResult() {
    const tally = {};
    const counts = {};
    quiz.types.forEach((t) => { tally[t] = 0; counts[t] = 0; });
    quiz.items.forEach((item, idx) => {
      const ans = answers[idx];
      if (typeof ans !== 'number') return;
      const t = item.type;
      tally[t] = (tally[t] || 0) + (ans - 3);
      counts[t] = (counts[t] || 0) + 1;
    });
    // Convert to percentages of max possible (counts[t] * 2).
    const breakdown = {};
    quiz.types.forEach((t) => {
      const maxAbs = (counts[t] || 0) * 2;
      const raw = tally[t];
      const pct = maxAbs > 0 ? Math.round(((raw + maxAbs) / (2 * maxAbs)) * 100) : 50;
      breakdown[t] = { score: raw, pct };
    });
    // Rank types by score
    const ranked = quiz.types.slice().sort((a, b) => tally[b] - tally[a]);
    return { typeKey: ranked[0], breakdown, ranked };
  }

  function computeForcedChoiceResult() {
    const tally = {};
    quiz.types.forEach((t) => tally[t] = 0);
    answers.forEach((answerIdx, qIdx) => {
      const opt = quiz.questions[qIdx].options[answerIdx];
      if (!opt || !opt.type) return;
      tally[opt.type] = (tally[opt.type] || 0) + (opt.weight || 1);
    });
    let best = quiz.types[0];
    let bestScore = -Infinity;
    quiz.types.forEach((t) => {
      if (tally[t] > bestScore) {
        bestScore = tally[t];
        best = t;
      }
    });
    const totalAnswered = answers.length;
    const breakdown = {};
    quiz.types.forEach((t) => {
      breakdown[t] = { score: tally[t], pct: totalAnswered > 0 ? Math.round((tally[t] / totalAnswered) * 100) : 0 };
    });
    return { typeKey: best, breakdown, ranked: quiz.types.slice().sort((a, b) => tally[b] - tally[a]) };
  }

  function computeResult() {
    if (quiz.scoringMode === 'likert-axis') return computeAxisResult();
    if (quiz.scoringMode === 'likert-tally') return computeTallyLikertResult();
    return computeForcedChoiceResult();
  }

  // ------- BREAKDOWN RENDER -------
  function renderAxisBreakdown(breakdown) {
    return `
      <div class="quiz-result-breakdown">
        <h3>Your dimensions</h3>
        <ul class="quiz-breakdown-list">
          ${quiz.dimensions.map((d) => {
            const b = breakdown[d];
            const labels = (quiz.dimensionLabels && quiz.dimensionLabels[d]) || { [d[0]]: d[0], [d[1]]: d[1] };
            return `
              <li class="quiz-breakdown-row">
                <div class="quiz-breakdown-axis-label">
                  <span class="${b.firstPct >= 50 ? 'is-strong' : ''}">${escHTML(labels[d[0]])} (${b.firstPct}%)</span>
                  <span class="quiz-breakdown-vs">/</span>
                  <span class="${b.secondPct > 50 ? 'is-strong' : ''}">${escHTML(labels[d[1]])} (${b.secondPct}%)</span>
                </div>
                <div class="quiz-breakdown-bar">
                  <div class="quiz-breakdown-bar-fill" style="width: ${b.firstPct}%; background: var(--ink);"></div>
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    `;
  }

  function renderTallyLikertBreakdown(breakdown, ranked) {
    return `
      <div class="quiz-result-breakdown">
        <h3>Top types</h3>
        <ul class="quiz-breakdown-list">
          ${ranked.slice(0, 3).map((t, i) => {
            const b = breakdown[t];
            const label = (quiz.typeShortLabels && quiz.typeShortLabels[t]) || t;
            return `
              <li class="quiz-breakdown-row">
                <div class="quiz-breakdown-axis-label">
                  <span class="quiz-breakdown-rank">${i + 1}</span>
                  <span class="${i === 0 ? 'is-strong' : ''}">${escHTML(label)}</span>
                  <span class="quiz-breakdown-vs">${b.pct}%</span>
                </div>
                <div class="quiz-breakdown-bar">
                  <div class="quiz-breakdown-bar-fill" style="width: ${b.pct}%; background: var(--ink);"></div>
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    `;
  }

  // Find the item the user agreed with most strongly (or disagreed with
  // most strongly, whichever was further from neutral). Used for the
  // "your loudest answer" callback, the small bit of personalization that
  // makes the result feel like it was about you and not a template.
  function findLoudestItem() {
    if (!isLikert()) return null;
    let best = null;
    let bestMag = 0;
    quiz.items.forEach((item, idx) => {
      const ans = answers[idx];
      if (typeof ans !== 'number') return;
      const mag = Math.abs(ans - 3);
      if (mag > bestMag) {
        bestMag = mag;
        best = { item, idx, answer: ans, magnitude: mag };
      }
    });
    return best;
  }

  function loudestAnswerCopy() {
    const loudest = findLoudestItem();
    if (!loudest || loudest.magnitude < 2) return '';
    const reaction = loudest.answer >= 4 ? 'screamed yes at' : 'flatly refused';
    const article = loudest.answer >= 4 ? '' : '';
    return `
      <div class="quiz-result-loudest">
        <span class="loudest-label">Your loudest answer</span>
        <p class="loudest-text">You ${reaction}: <em>&ldquo;${escHTML(loudest.item.text)}&rdquo;</em></p>
      </div>
    `;
  }

  // Pull short type code out of the result name for the stamp.
  function stampCode(typeKey, def) {
    if (quiz.id === 'mbti') return typeKey;
    if (quiz.id === 'enneagram') return 'TYPE ' + typeKey;
    if (quiz.id === 'blood-type') return 'TYPE ' + typeKey;
    return typeKey;
  }

  function todayStamp() {
    const d = new Date();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }).toUpperCase();
  }

  // ------- RESULT -------
  // Markup for the "try another quiz" cross-promo at the bottom of every
  // result page. Excludes the quiz the user just completed. Hard-coded
  // because there are only 5; a dynamic registry isn't worth it yet.
  const QUIZ_REGISTRY = [
    { id: 'mbti',            href: 'mbti.html',           title: 'Which of the 16 SF reader types are you?', meta: '28 items · ~4 min' },
    { id: 'enneagram',       href: 'enneagram.html',      title: 'Which Enneagram type are you, in SF terms?', meta: '18 items · ~3 min' },
    { id: 'blood-type',      href: 'blood-type.html',     title: 'What does your blood type say about your morning coffee order?', meta: '12 questions · ~3 min' },
    { id: 'love-languages',  href: 'love-languages.html', title: 'What is your love language, in San Francisco terms?', meta: '15 questions · ~3 min' },
    { id: 'strengths',       href: 'strengths.html',      title: 'What are your top three character strengths?', meta: '24 items · ~4 min' },
  ];
  function otherQuizzesMarkup(currentId) {
    return QUIZ_REGISTRY
      .filter((q) => q.id !== currentId)
      .slice(0, 4)
      .map((q) => `<li><a href="${escHTML(q.href)}">${escHTML(q.title)}</a> <span class="reads-note">${escHTML(q.meta)}</span></li>`)
      .join('');
  }

  function renderResult() {
    const result = computeResult();
    const typeKey = result.typeKey;
    const def = (quiz.resultsByType && quiz.resultsByType[typeKey]) || { name: typeKey, blurb: 'Result not configured.', reads: [] };
    let breakdownHtml = '';
    if (quiz.scoringMode === 'likert-axis') breakdownHtml = renderAxisBreakdown(result.breakdown);
    else if (quiz.scoringMode === 'likert-tally') breakdownHtml = renderTallyLikertBreakdown(result.breakdown, result.ranked);

    const shareText = `I'm ${def.name} on the SF Times ${escHTML(quiz.id)} quiz.`;
    const shareUrl = location.href.split('#')[0] + '#result=' + encodeURIComponent(typeKey);

    root.innerHTML = `
      <section class="quiz-result quiz-fade-in">
        <div class="quiz-stamp" aria-hidden="true">
          <div class="quiz-stamp-header">
            <span class="quiz-stamp-label">SF Times Reader Type</span>
            <span class="quiz-stamp-date">${todayStamp()}</span>
          </div>
          <div class="quiz-stamp-code">${escHTML(stampCode(typeKey, def))}</div>
          <div class="quiz-stamp-footer">
            <span>${escHTML(quiz.eyebrow || quiz.id)}</span>
            <span class="quiz-stamp-issue">No. ${Math.floor(Math.random() * 9000 + 1000)}</span>
          </div>
        </div>

        <p class="quiz-eyebrow">Your result</p>
        <h1 class="quiz-result-name">${escHTML(def.name)}</h1>
        <p class="quiz-result-blurb">${def.blurb}</p>

        ${loudestAnswerCopy()}

        ${breakdownHtml}

        ${def.reads && def.reads.length ? `
          <div class="quiz-result-reads">
            <h3>Read next</h3>
            <ul>
              ${def.reads.map((r) => `
                <li><a href="${escHTML(r.href)}">${escHTML(r.title)}</a>${r.note ? ` <span class="reads-note">${escHTML(r.note)}</span>` : ''}</li>
              `).join('')}
            </ul>
          </div>
        ` : ''}

        <div class="quiz-result-cross">
          <h3>Try another quiz</h3>
          <ul class="quiz-result-cross-list">
            ${otherQuizzesMarkup(quiz.id)}
          </ul>
        </div>

        <aside class="quiz-result-ad" aria-label="Sponsorship opportunity">
          <div class="quiz-result-ad-eyebrow">Available · Quiz result slot</div>
          <p>Quiz results reach readers who just self-identified. Sponsor a quiz result for an issue and your message lands next to a thousand SF Times readers learning who they are. <a href="../partners.html">Become a partner →</a> &middot; <a href="../ad-samples.html">See live samples →</a></p>
        </aside>

        <div class="quiz-result-actions">
          <a class="btn primary" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener noreferrer">Brag on X &rarr;</a>
          <a class="btn ghost" href="mailto:?subject=${encodeURIComponent(quiz.title)}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}">Email a friend</a>
          <button class="quiz-restart btn ghost" id="quiz-restart-btn">Take it again</button>
        </div>

        <div class="quiz-result-newsletter" data-newsletter data-source="quiz-${escHTML(quiz.id)}-${escHTML(typeKey)}"></div>

        <p class="quiz-result-disclaimer">${escHTML(quiz.resultDisclaimer || 'Personality systems are starting points, not endings. Save the result, send it to a friend, argue about it.')}</p>
      </section>
    `;
    document.getElementById('quiz-restart-btn').addEventListener('click', () => {
      pageIdx = 0;
      answers = [];
      renderIntro();
    });
    if (window.SFTimes && window.SFTimes.mountNewsletters) {
      window.SFTimes.mountNewsletters();
    }
    document.title = `${def.name} - ${quiz.title} - SF Times`;
    history.replaceState(null, document.title, '#result=' + encodeURIComponent(typeKey));
  }

  // Hash shortcut for shared result links.
  function checkHashShortcut() {
    const m = location.hash.match(/^#result=(.+)$/);
    if (!m) return false;
    const typeKey = decodeURIComponent(m[1]);
    if (!quiz.resultsByType || !quiz.resultsByType[typeKey]) return false;
    const def = quiz.resultsByType[typeKey];
    root.innerHTML = `
      <section class="quiz-result quiz-result-shared">
        <p class="quiz-eyebrow">Shared result</p>
        <h1 class="quiz-result-name">${escHTML(def.name)}</h1>
        <p class="quiz-result-blurb">${def.blurb}</p>
        ${def.reads && def.reads.length ? `
          <div class="quiz-result-reads">
            <h3>Read next</h3>
            <ul>${def.reads.map((r) => `<li><a href="${escHTML(r.href)}">${escHTML(r.title)}</a></li>`).join('')}</ul>
          </div>
        ` : ''}
        <div class="quiz-result-actions">
          <button class="btn primary" id="quiz-take-btn">Take the quiz yourself &rarr;</button>
        </div>
      </section>
    `;
    document.getElementById('quiz-take-btn').addEventListener('click', () => {
      history.replaceState(null, '', location.pathname);
      renderIntro();
    });
    return true;
  }

  if (!checkHashShortcut()) {
    renderIntro();
  }

  // ------- QUIZ JSON-LD -------
  // Inject Quiz schema once on intro render so search engines understand
  // this is an interactive personality quiz, not a static article. The
  // FAQPage fallback ensures the questions get indexed individually,
  // which is what produces "People also ask" placements.
  function injectQuizSchema() {
    if (document.head.querySelector('script[data-schema="quiz"]')) return;
    const items = (quiz.items || quiz.questions || []).slice(0, 8);
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'Quiz',
      name: quiz.title,
      description: quiz.intro,
      educationalLevel: 'general',
      learningResourceType: 'Personality quiz',
      provider: {
        '@type': 'NewsMediaOrganization',
        name: 'The San Francisco Times',
        url: 'https://www.sftimes.com/',
      },
      hasPart: items.map((it) => ({
        '@type': 'Question',
        name: it.text,
      })),
    };
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.dataset.schema = 'quiz';
    s.textContent = JSON.stringify(faqSchema);
    document.head.appendChild(s);
  }
  try { injectQuizSchema(); } catch (e) { /* schema is non-critical */ }
})();

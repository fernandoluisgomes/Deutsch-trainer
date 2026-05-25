
const STORAGE_KEY="vocabularyGermanTrainer_v5"; // mantém os dados existentes da V5
const MASTER_LIMIT=7;
let vocabulary=[],practiceQueue=[],currentCard=null,revealed=false,correctCount=0,wrongCount=0;let sessionStartedAt=Date.now(),sessionInitialSnapshot={};window.sessionCardCounter=0;let sessionMasteredRemembered=0,sessionMasteredForgotten=0,sessionRecoveredConfirmations=0,sessionFailedConfirmations=0;
let touchStartX=0,touchStartY=0,touchCurrentX=0,isDragging=false;const swipeThreshold=80;let recognition=null;let isListening=false;let micMasterOn=false;let autoMicTimer=null;let autoMicRetryTimer=null;let appIsSpeaking=false;let appSpeechCooldownUntil=0;let autoMicSilentStartedAt=0;let changesSinceBackup=Number(localStorage.getItem('changesSinceBackup')||0);

function $(id){return document.getElementById(id)}
function normalize(t){return (t||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function showNotice(target,msg,type="ok"){const b=$(target);b.className="notice "+type;b.innerHTML=msg;setTimeout(()=>{b.className="";b.innerHTML=""},4000)}
function loadVocabulary(){try{vocabulary=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch(e){vocabulary=[]}vocabulary.forEach(x=>{if(x.correctStreak===undefined)x.correctStreak=0;if(x.wrongStreak===undefined)x.wrongStreak=0;if(x.difficultyBoost===undefined)x.difficultyBoost=false;if(x.mastered===undefined)x.mastered=false;
if(x.memoryLevel===undefined)x.memoryLevel=0;
if(x.studyState===undefined)x.studyState="new";
if(x.successCount===undefined)x.successCount=0;
if(x.failCount===undefined)x.failCount=0;
if(x.seenCount===undefined)x.seenCount=0;
if(x.nextReviewAt===undefined)x.nextReviewAt=0;
if(x.lastReviewedAt===undefined)x.lastReviewedAt=0;
if(x.reviewIntervalDays===undefined)x.reviewIntervalDays=0;
if(x.sessionDueAt===undefined)x.sessionDueAt=0;
if(x.stabilityScore===undefined)x.stabilityScore=0;
if(x.xp===undefined)x.xp=0;
if(x.learningState===undefined)x.learningState = x.mastered ? "mastered" : "auto";
if(x.totalReviews===undefined)x.totalReviews=0;
if(x.lastSessionSeen===undefined)x.lastSessionSeen=0;
if(x.errorStats===undefined)x.errorStats={memory:0,article:0,grammar:0}})}
function saveVocabulary(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(vocabulary));
  changesSinceBackup++;
  localStorage.setItem("changesSinceBackup", String(changesSinceBackup));
  updateBackupInfo();
}
function parseSynonyms(t){return t?t.split(",").map(s=>s.trim()).filter(Boolean):[]}
function getAllAnswers(c){const a=[c.de,...(c.synonyms||[])],u=[];for(const x of a)if(x&&!u.some(y=>normalize(y)===normalize(x)))u.push(x);return u}
function allGermanTerms(c){return getAllAnswers(c).map(normalize)}
function activeVocabulary(){
return vocabulary.filter(x => (x.learningState||"auto") !== "suspended" && (x.learningState||"auto") !== "mastered");
}

function cleanGermanForSpeech(text){
  const value = (text || "").trim();
  if($("speakArticle") && $("speakArticle").checked) return value;
  return value.replace(/^(der|die|das)\s+/i,"").trim() || value;
}

function escapeHtml(text){
  return (text || "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[char]));
}

function formatGerman(text){
  const value = (text || "").trim();
  const match = value.match(/^(der|die|das)\s+(.+)$/i);
  if(!match) return escapeHtml(value);
  const article = match[1].toLowerCase();
  const rest = match[2];
  return `<span class="article article-${article}">${article}</span>${escapeHtml(rest)}`;
}


function markAppSpeechStart(){
  appIsSpeaking = true;
  appSpeechCooldownUntil = Date.now() + 1500;
}

function markAppSpeechEnd(){
  appIsSpeaking = false;
  appSpeechCooldownUntil = Date.now() + 1500;
}

function appAudioActive(){
  return appIsSpeaking ||
         Date.now() < appSpeechCooldownUntil ||
         (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending));
}

function pauseRecognitionForAppSpeech(){
  if(recognition && isListening){
    try { recognition.stop(); } catch(e) {}
  }
  isListening = false;
  if(micMasterOn && isAutoMicMode()){
    setMicStatus("preparing", "preparação");
  }
}

function speakGerman(text){
  if(!$("speechEnabled") || !$("speechEnabled").checked) return;
  if(!("speechSynthesis" in window)) return;
  pauseRecognitionForAppSpeech();
  const utterance = new SpeechSynthesisUtterance(cleanGermanForSpeech(text));
  utterance.lang = "de-DE";
  utterance.rate = 0.85;
  utterance.pitch = 1;
  utterance.onstart = markAppSpeechStart;
  utterance.onend = markAppSpeechEnd;
  utterance.onerror = markAppSpeechEnd;
  window.speechSynthesis.cancel();
  markAppSpeechStart();
  window.speechSynthesis.speak(utterance);
}

function speakPortuguese(text){
  if(!$("speakPortuguese") || !$("speakPortuguese").checked) return;
  if(!("speechSynthesis" in window)) return;

  pauseRecognitionForAppSpeech();

  const utterance = new SpeechSynthesisUtterance(text || "");
  utterance.lang = "pt-PT";
  utterance.rate = 0.82;
  utterance.pitch = 1;
  utterance.onstart = markAppSpeechStart;
  utterance.onend = markAppSpeechEnd;
  utterance.onerror = markAppSpeechEnd;

  // Pausa maior para não cortar a resposta alemã anterior.
  // Não usamos cancel() aqui, porque isso interrompia a voz alemã.
  markAppSpeechStart();
  setTimeout(() => {
    if(window.speechSynthesis.speaking){
      setTimeout(() => window.speechSynthesis.speak(utterance), 1200);
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }, 1300);
}

function stripGermanArticle(text){
  return (text||"").replace(/^(der|die|das)\s+/i,"").trim();
}

function normalizeVoice(text){
  return normalize((text||"")
    .replace(/[.,!?;:]/g," ")
    .replace(/\s+/g," ")
  );
}

function voiceForms(text){
  const original = normalizeVoice(text);
  const noArticle = normalizeVoice(stripGermanArticle(text));
  const forms = [original];
  if(!$("requireArticle") || !$("requireArticle").checked) forms.push(noArticle);
  return [...new Set(forms.filter(Boolean))];
}

function levenshtein(a,b){
  const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)dp[i][0]=i;
  for(let j=0;j<=b.length;j++)dp[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    }
  }
  return dp[a.length][b.length];
}

function isCloseEnough(spoken, expected){
  if(spoken === expected) return true;
  const strictness = $("voiceStrictness") ? $("voiceStrictness").value : "normal";
  if(strictness === "strict") return false;
  const dist = levenshtein(spoken, expected);
  const maxLen = Math.max(spoken.length, expected.length);
  const threshold = strictness === "loose" ? Math.max(1, Math.floor(maxLen*0.28)) : Math.max(1, Math.floor(maxLen*0.18));
  return maxLen >= 5 && dist <= threshold;
}


const GERMAN_ARTICLES = ["der","die","das","den","dem","des","ein","eine","einen","einem","einer"];
const CRITICAL_WORDS = [
  "für","mit","zu","auf","an","in","bei","nach","von","über","unter","vor","aus","um","gegen",
  "dich","dir","mich","mir","ihn","ihm","sie","ihnen","uns","euch","sich",
  "ich","du","er","es","wir","ihr"
];

function tokenizeGerman(text){
  return normalizeVoice(text)
    .replace(/[“”„"]/g,"")
    .split(/\s+/)
    .filter(Boolean);
}

function removeOptionalArticles(tokens){
  if($("requireArticle") && $("requireArticle").checked) return tokens;
  return tokens.filter(t => !GERMAN_ARTICLES.includes(t));
}

function isSentenceLike(text){
  return tokenizeGerman(text).length >= 3;
}

function criticalSequence(tokens){
  return tokens.filter(t => CRITICAL_WORDS.includes(t));
}

function hasStrictGrammarMismatch(spoken, expected){
  // Esta opção controla APENAS regras gramaticais em frases.
  // Se estiver desligada, frases ficam mais permissivas.
  if(!$("strictGrammarRecognition") || !$("strictGrammarRecognition").checked) return false;

  const spokenTokens = removeOptionalArticles(tokenizeGerman(spoken));
  const expectedTokens = removeOptionalArticles(tokenizeGerman(expected));

  // Só aplicamos esta regra forte a frases/expressões, não a palavras isoladas.
  if(expectedTokens.length < 3) return false;

  const spokenCritical = criticalSequence(spokenTokens).join("|");
  const expectedCritical = criticalSequence(expectedTokens).join("|");

  if(spokenCritical !== expectedCritical) return true;

  const minLen = Math.min(spokenTokens.length, expectedTokens.length);

  for(let i=0;i<minLen;i++){
    const s = spokenTokens[i];
    const e = expectedTokens[i];

    if(s === e) continue;

    // Com gramática rigorosa ON, preposições/pronomes/palavras curtas críticas falham.
    const criticalMismatch =
      CRITICAL_WORDS.includes(s) ||
      CRITICAL_WORDS.includes(e);

    if(criticalMismatch) return true;

    if((s.length <= 3 || e.length <= 3) && s !== e){
      return true;
    }
  }

  return false;
}

function smartSimilarity(spoken, expected){
  const s = removeOptionalArticles(tokenizeGerman(spoken));
  const e = removeOptionalArticles(tokenizeGerman(expected));

  const spokenNorm = s.join(" ");
  const expectedNorm = e.join(" ");

  if(spokenNorm === expectedNorm) return 1;

  if(!s.length || !e.length) return 0;

  let same = 0;
  for(const token of s){
    if(e.includes(token)) same++;
  }

  return same / Math.max(s.length, e.length);
}


function firstToken(text){
  const tokens = tokenizeGerman(text);
  return tokens.length ? tokens[0] : "";
}

function hasRequiredArticleMismatch(spoken, expected){
  if(!$("requireArticle") || !$("requireArticle").checked) return false;

  const expectedArticle = firstToken(expected);

  // Só aplica quando a resposta esperada começa com artigo.
  if(!GERMAN_ARTICLES.includes(expectedArticle)) return false;

  const spokenArticle = firstToken(spoken);

  // Artigo obrigatório: tem de existir e ser exatamente igual.
  return spokenArticle !== expectedArticle;
}

function isSmartCloseEnough(spoken, expected){
  // Artigo obrigatório é validado antes de qualquer tolerância.
  // Esta regra é independente da opção de gramática das frases.
  if(hasRequiredArticleMismatch(spoken, expected)){
    return false;
  }

  const spokenClean = removeOptionalArticles(tokenizeGerman(spoken)).join(" ");
  const expectedClean = removeOptionalArticles(tokenizeGerman(expected)).join(" ");

  if(spokenClean === expectedClean) return true;

  if(hasStrictGrammarMismatch(spoken, expected)) return false;

  const sentence = isSentenceLike(expected);

  if(sentence){
    const strictGrammarOn = $("strictGrammarRecognition") && $("strictGrammarRecognition").checked;
    const threshold = strictGrammarOn ? 0.90 : 0.70;
    return smartSimilarity(spoken, expected) >= threshold;
  }

  // Palavras isoladas continuam tolerantes, mas só depois da validação do artigo.
  return isCloseEnough(spokenClean, expectedClean);
}

function checkVoiceAnswer(spokenText){
  if(!currentCard) return false;

  const accepted = getAllAnswers(currentCard);

  for(const ans of accepted){
    if(isSmartCloseEnough(spokenText, ans)){
      return true;
    }
  }

  return false;
}


function showVoiceCardFeedback(correct, heard, expected){
  const card = $("card");
  if(correct){
    card.className = "card green revealed";
    card.innerHTML = `
      <div class="answer-title">✅ ${formatGerman(expected)}</div>
    `;
  }else{
    card.className = "card red revealed";
    card.innerHTML = `
      <div class="answer-title">❌ ${heard || "?"}</div>
      <div style="margin-top:14px">✅ ${formatGerman(expected)}</div>
    `;
  }
}

function showVoiceDebug(correct, heard, accepted, alternatives){
  $("voiceResult").innerHTML = `
    <div class='${correct ? "voiceOk" : "voiceBad"}'>${correct ? "✅" : "❌"} ${heard || "?"}</div>
    <div class='small' style='margin-top:8px;text-align:left'>
      <strong>Ouvi:</strong><br>
      ${alternatives.map((a,i)=>`${i+1}. ${a}`).join("<br>")}
      <br><br>
      <strong>Aceites:</strong><br>
      ${accepted.join(" · ")}
      ${hasRequiredArticleMismatch(heard, accepted[0] || "") ? "<br><br><span class='voiceBad'>Artigo incorreto ou em falta.</span>" : ""}${hasStrictGrammarMismatch(heard, accepted[0] || "") ? "<br><span class='voiceBad'></span>" : ""}
    </div>
  `;
}


function exactVoiceMatch(spokenText, expectedText){
  return normalizeVoice(spokenText) === normalizeVoice(expectedText);
}

function wordWithoutArticleMatch(spokenText, expectedText){
  return normalizeVoice(stripGermanArticle(spokenText)) === normalizeVoice(stripGermanArticle(expectedText));
}

function bestExpectedAnswer(spokenText){
  if(!currentCard) return "";
  const accepted = getAllAnswers(currentCard);
  const exact = accepted.find(a => exactVoiceMatch(spokenText, a));
  if(exact) return exact;

  const noArticle = accepted.find(a => wordWithoutArticleMatch(spokenText, a));
  if(noArticle) return noArticle;

  return accepted[0] || "";
}

function shouldRepeatHeard(spokenText){
  if(!currentCard) return false;
  const accepted = getAllAnswers(currentCard);
  return accepted.some(a => exactVoiceMatch(spokenText, a));
}

function speakFeedbackForVoice(correct, heard){
  const expected = bestExpectedAnswer(heard);
  if(correct && shouldRepeatHeard(heard)){
    speakGerman(heard);
  }else{
    speakGerman(expected);
  }
  return expected;
}


function setMicStatus(state, text){
  const dot = $("micStatusDot");
  const label = $("micStatusText");
  if(dot) dot.className = "micStatusDot " + state;
  if(label) label.textContent = text;
}

function setMicButton(on){
  if(on){
    $("micBtn").classList.add("micOn");
    $("micBtn").textContent = "🎤 Desligar microfone";
  }else{
    $("micBtn").classList.remove("micOn");
    $("micBtn").textContent = "🎤 Ligar microfone";
  }
}

function isAutoMicMode(){
  return $("autoMicEnabled") && $("autoMicEnabled").checked;
}

function shouldWaitForPortugueseBeforeMic(){
  return $("waitForPortugueseBeforeMic") && $("waitForPortugueseBeforeMic").checked;
}

function getAutoMicMaxSilentMs(){
  const minutes = $("autoMicMaxSilentMinutes") ? Number($("autoMicMaxSilentMinutes").value) : 5;
  return minutes * 60 * 1000;
}

function resetAutoMicSilentTimer(){
  autoMicSilentStartedAt = Date.now();
}

function autoMicSilenceLimitReached(){
  if(!autoMicSilentStartedAt) resetAutoMicSilentTimer();
  return Date.now() - autoMicSilentStartedAt > getAutoMicMaxSilentMs();
}

function clearAutoMicTimers(){
  clearTimeout(autoMicTimer);
  clearTimeout(autoMicRetryTimer);
}

function stopAllMicActivity(){
  micMasterOn = false;
  autoMicSilentStartedAt = 0;
  clearAutoMicTimers();
  if(recognition && isListening){
    try{ recognition.stop(); }catch(e){}
  }
  isListening = false;
  setMicButton(false);
  setMicStatus("off", "desligado");
}

function tryStartListening(autoStarted=false){
  if(!micMasterOn && autoStarted) return;
  if(isListening) return;

  if(!$("voiceEnabled") || !$("voiceEnabled").checked){
    $("voiceResult").innerHTML = "<span class='voiceBad'>Reconhecimento de voz desativado na configuração.</span>";
    stopAllMicActivity();
    return;
  }

  if(!currentCard) return;
  if(!recognition) recognition = setupRecognition();
  if(!recognition) return;

  if(shouldWaitForPortugueseBeforeMic() && appAudioActive()){
    setMicStatus("preparing", "preparação");
    autoMicRetryTimer = setTimeout(()=>scheduleAutoMic(), 50);
    return;
  }

  setMicStatus("preparing", "preparação");

  try{
    recognition.start();
  }catch(e){
    if(autoStarted && micMasterOn && isAutoMicMode()){
      autoMicRetryTimer = setTimeout(()=>tryStartListening(true), 1500);
    }else{
      $("voiceResult").innerHTML = "<span class='voiceBad'>Não consegui iniciar o microfone.</span>";
      if(!isAutoMicMode()) stopAllMicActivity();
    }
  }
}

function scheduleAutoMic(){
  clearAutoMicTimers();

  if(!micMasterOn) return;
  if(!isAutoMicMode()) return;
  if(!currentCard) return;

  const delay = $("autoMicDelay") ? Number($("autoMicDelay").value) : 3000;

  // Delay configurado: apenas antes da primeira tentativa de ouvir após a carta/voz PT.
  setMicStatus("preparing", "preparação");

  autoMicTimer = setTimeout(() => {
    if(appAudioActive()){
      // Se a app ainda está a falar, espera em pequenos ciclos, sem reaplicar o delay completo.
      autoMicRetryTimer = setTimeout(() => scheduleAutoMic(), 300);
      return;
    }

    tryStartListening(true);
  }, delay);
}

function retryAutoMicAfterSilence(){
  clearAutoMicTimers();

  if(!micMasterOn) return;
  if(!isAutoMicMode()) return;
  if(!currentCard) return;

  if(autoMicSilenceLimitReached()){
    stopAllMicActivity();
    $("voiceResult").innerHTML = "<span class='small'>Microfone automático desligado após período de silêncio.</span>";
    return;
  }

  setMicStatus("preparing", "preparação");

  // Retry rápido após silêncio: não usa a configuração "espera antes de ouvir".
  autoMicRetryTimer = setTimeout(() => {
    if(shouldWaitForPortugueseBeforeMic() && appAudioActive()){
      retryAutoMicAfterSilence();
      return;
    }

    tryStartListening(true);
  }, 600);
}

function setupRecognition(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    $("voiceResult").innerHTML = "<span class='voiceBad'>Reconhecimento de voz não disponível neste browser.</span>";
    return null;
  }
  const rec = new SpeechRecognition();
  rec.lang = "de-DE";
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 5;

  rec.onstart = () => {
    isListening = true;
    setMicButton(true);
    setMicStatus("listening", "a ouvir…");
    $("voiceResult").innerHTML = "<span class='voiceListening'>A ouvir... diz a resposta em alemão</span>";
  };

  rec.onend = () => {
    isListening = false;

    if(isAutoMicMode() && micMasterOn){
      retryAutoMicAfterSilence();
    }else{
      stopAllMicActivity();
    }
  };

  rec.onerror = (event) => {
    isListening = false;

    if(event.error === "no-speech" && isAutoMicMode() && micMasterOn){
      retryAutoMicAfterSilence();
      return;
    }

    if(event.error !== "no-speech"){
      $("voiceResult").innerHTML = `<span class='voiceBad'>Erro no microfone: ${event.error}</span>`;
    }

    if(isAutoMicMode() && micMasterOn){
      retryAutoMicAfterSilence();
    }else{
      stopAllMicActivity();
    }
  };

  rec.onresult = (event) => {
    resetAutoMicSilentTimer();
    const alternatives = Array.from(event.results[0]).map(r => r.transcript);
    const best = alternatives[0] || "";
    const accepted = getAllAnswers(currentCard);
    const expected = accepted[0] || "";
    const correct = alternatives.some(t => checkVoiceAnswer(t));

    if($("voiceDebug") && $("voiceDebug").checked){
      showVoiceDebug(correct, best, accepted, alternatives);
    }else{
      $("voiceResult").innerHTML = "";
    }

    const spokenExpected = speakFeedbackForVoice(correct, best);

    if(correct){
      registerCorrect();
      correctCount++;
      removeCurrentFromQueue();
      showVoiceCardFeedback(true, best, spokenExpected || expected);
      updateStats();
    }else{
      const expectedForError = spokenExpected || expected || bestExpectedAnswer(best);
      const classifiedError = dt52Classify(expectedForError, best);
      registerWrong(classifiedError, best);
      wrongCount++;
      showVoiceCardFeedback(false, best, spokenExpected || expected);
      updateStats();
    }

    setTimeout(() => {
      nextCard();

      if(micMasterOn && isAutoMicMode()){
        // O scheduleAutoMic já respeita appAudioActive, mas deixamos uma margem extra.
        scheduleAutoMic();
      }else if(micMasterOn && !isAutoMicMode()){
        stopAllMicActivity();
      }
    }, 5000);
  };

  return rec;
}

function startVoiceRecognition(autoStarted=false){
  // Quando vem de um clique, o browser passa MouseEvent. Isto deve contar como manual.
  if(autoStarted && typeof autoStarted === "object") autoStarted = false;

  if(!autoStarted){
    if(micMasterOn){
      stopAllMicActivity();
      $("voiceResult").innerHTML = "<span class='small'>Microfone desligado.</span>";
      return;
    }

    micMasterOn = true;
    resetAutoMicSilentTimer();
    setMicButton(true);
    setMicStatus("preparing", "preparação");
  }

  tryStartListening(autoStarted);
}

function stopVoiceRecognition(){
  stopAllMicActivity();
  $("voiceResult").innerHTML = "";
}

function switchPage(page){
if(page !== "train") stopAllMicActivity();
["train","statsPage","add","db","config"].forEach(p=>$("page-"+p).classList.toggle("hidden",p!==page));
document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.page===page));
if(page==="db") renderWordList();
if(page==="statsPage") renderStatsPage();
if(page==="train") startPractice();
}

function findDuplicates(pt,de,synonyms,ignoreIndex=null){
const incoming=[de,...synonyms].map(normalize).filter(Boolean),ptNorm=normalize(pt);let matches=[];
vocabulary.forEach((item,i)=>{if(ignoreIndex!==null&&i===ignoreIndex)return;const existingTerms=allGermanTerms(item);const germanOverlap=incoming.filter(x=>existingTerms.includes(x));const ptSame=ptNorm&&normalize(item.pt)===ptNorm;if(ptSame||germanOverlap.length)matches.push({index:i,item,ptSame,germanOverlap})});
return matches;
}
function mergeSynonyms(existing, incoming){
  const combined = [...(existing || []), ...(incoming || [])];
  const unique = [];
  combined.forEach(value => {
    if(value && !unique.some(x => normalize(x) === normalize(value))) unique.push(value);
  });
  return unique;
}
function findBestExistingIndex(pt,de,synonyms){
  const matches = findDuplicates(pt,de,synonyms,null);
  if(!matches.length) return -1;
  const exactDe = normalize(de);
  const exactPt = normalize(pt);
  const exact = matches.find(m => normalize(m.item.de) === exactDe || normalize(m.item.pt) === exactPt);
  return exact ? exact.index : matches[0].index;
}
function renderDuplicateWarning(){
const editIndex=$("editIndex").value===""?null:Number($("editIndex").value);
const matches=findDuplicates($("ptWord").value,$("deWord").value,parseSynonyms($("synonyms").value),editIndex),box=$("duplicateNotice");
if(!matches.length){box.className="";box.innerHTML="";return matches}
box.className="notice warn";box.innerHTML="<strong>Possível duplicado encontrado:</strong><ul class='dup-list'>"+matches.map(m=>`<li>${m.item.pt} → ${m.item.de}${m.germanOverlap.length?`<br>Termos repetidos: ${m.germanOverlap.join(", ")}`:""}${m.ptSame?"<br>Mesmo significado em português.":""}</li>`).join("")+"</ul><span class='small'>Podes guardar mesmo assim.</span>";return matches;
}


function resetLearningForCurrentEdit(){
 const editVal=$("editIndex").value;
 if(editVal===""){showNotice("saveNotice","Guarda primeiro a palavra antes de resetar aprendizagem.","warn");return}
 const idx=Number(editVal), w=vocabulary[idx];
 if(!w)return;
 w.memoryLevel=0;w.stabilityScore=0;w.xp=0;w.studyState="new";w.mastered=false;w.difficultyBoost=false;
 w.correctStreak=0;w.wrongStreak=0;w.sessionDueAt=0;w.nextReviewAt=0;w.reviewIntervalDays=0;
 saveVocabulary();showNotice("saveNotice","Aprendizagem resetada para esta palavra.","ok");renderWordList();startPractice();
}

function saveWord(){
const pt=$("ptWord").value.trim(),de=$("deWord").value.trim(),syn=parseSynonyms($("synonyms").value),sent=$("sentence").value.trim();
if(!pt||!de){showNotice("saveNotice","Preenche pelo menos português e alemão.","error");return}
const editVal=$("editIndex").value, mastered=$("masteredCheck").checked;
let previous = editVal==="" ? {} : vocabulary[Number(editVal)];
const item={
pt,de,synonyms:syn,sentence:sent,
createdAt:previous.createdAt||Date.now(),
updatedAt:Date.now(),
sessionDueAt:0,
correctStreak: mastered ? Math.max(previous.correctStreak||0, minStreakToMaster ? minStreakToMaster() : 3) : (previous.correctStreak||0),
wrongStreak: mastered ? 0 : (previous.wrongStreak||0),
difficultyBoost: mastered ? false : (previous.difficultyBoost||false),
mastered,
learningState:$("learningState") ? $("learningState").value : "auto",
memoryLevel: mastered ? 100 : (previous.memoryLevel||0),
studyState: mastered ? "mastered" : (previous.studyState||"new"),
successCount: previous.successCount||0,
failCount: previous.failCount||0,
seenCount: previous.seenCount||0,
errorStats: previous.errorStats || {memory:0,article:0,grammar:0}
};
if(editVal===""){vocabulary.push(item);showNotice("saveNotice","Palavra adicionada.","ok")}
else{vocabulary[Number(editVal)]=item;showNotice("saveNotice","Palavra atualizada.","ok")}
saveVocabulary();clearForm();renderWordList();startPractice();
}
function clearForm(){
$("editIndex").value="";$("formTitle").textContent="Adicionar vocabulário";$("ptWord").value="";$("deWord").value="";$("synonyms").value="";$("sentence").value="";$("masteredCheck").checked=false;$("duplicateNotice").className="";$("duplicateNotice").innerHTML="";
}
function editWord(i){
const item=vocabulary[i];$("editIndex").value=i;$("formTitle").textContent="Editar vocabulário";$("ptWord").value=item.pt;$("deWord").value=item.de;$("synonyms").value=(item.synonyms||[]).join(", ");$("sentence").value=item.sentence||"";$("masteredCheck").checked=!!item.mastered;switchPage("add");renderDuplicateWarning();window.scrollTo({top:0,behavior:"smooth"});
}
function deleteWord(i){if(!confirm("Apagar esta palavra?"))return;vocabulary.splice(i,1);saveVocabulary();renderWordList();startPractice()}
function clearAllWords(){if(!confirm("Queres mesmo apagar todo o vocabulário?"))return;vocabulary=[];practiceQueue=[];currentCard=null;correctCount=0;wrongCount=0;saveVocabulary();renderWordList();startPractice()}



function takeSessionSnapshot(){
  sessionStartedAt = Date.now();
  window.sessionCardCounter=0;
  sessionMasteredRemembered=0;
  sessionMasteredForgotten=0;
  sessionRecoveredConfirmations=0;
  sessionFailedConfirmations=0;
  sessionInitialSnapshot = {};
  vocabulary.forEach((w,i)=>{
    sessionInitialSnapshot[i] = {
      memoryLevel: w.memoryLevel || 0,
      mastered: !!w.mastered,
learningState:$("learningState") ? $("learningState").value : "auto",
      studyState: w.studyState || "new",
      failCount: w.failCount || 0,
      successCount: w.successCount || 0,
      difficultyBoost: !!w.difficultyBoost
    };
  });
}

function sessionSummaryHtml(){
  const durationMin = Math.max(1, Math.round((Date.now() - sessionStartedAt)/60000));
  let improved = 0, newlyMastered = 0, stillCritical = 0, difficult = 0, errors = 0, learnedActive = 0, dueTomorrow = 0;

  vocabulary.forEach((w,i)=>{
    const before = sessionInitialSnapshot[i] || {};
    const beforeMem = before.memoryLevel || 0;
    const nowMem = w.memoryLevel || 0;

    if(nowMem > beforeMem) improved++;
    if(!before.mastered && w.mastered) newlyMastered++;
    if(isCritical(w)) stillCritical++;
    if(w.difficultyBoost && !w.mastered) difficult++;
    if((w.failCount||0) > (before.failCount||0)) errors++;
    if((w.studyState||"new") === "learning" && !w.mastered) learnedActive++;
    if(w.nextReviewAt && w.nextReviewAt <= Date.now()+24*60*60*1000) dueTomorrow++;
  });

  const avgMemory = vocabulary.length ? Math.round(vocabulary.reduce((s,w)=>s+(w.memoryLevel||0),0)/vocabulary.length) : 0;
const dueNow = vocabulary.filter(w=>isDueForReview(w) && (w.mastered || w.studyState==="mastered")).length;
const criticalNow = vocabulary.filter(w=>isCritical(w)).length;

  return `
    <div class="answer-title">Sessão concluída 🎉</div>
    <div class="grid2" style="font-size:16px;text-align:left;margin-top:14px">
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Duração:</strong><br>${durationMin} min</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Cartões apresentados:</strong><br>${correctCount + wrongCount}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Consolidadas:</strong><br>${newlyMastered}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Palavras recuperadas:</strong><br>${improved}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Palavras difíceis:</strong><br>${difficult}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Zona crítica ativa ativa:</strong><br>${stillCritical}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Dominadas recordadas:</strong><br>${sessionMasteredRemembered}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Dominadas esquecidas:</strong><br>${sessionMasteredForgotten}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Recuperadas:</strong><br>${sessionRecoveredConfirmations}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Revisões 24h:</strong><br>${dueTomorrow}</div><div class="box" style="box-shadow:none;background:#f8fafc"><strong>Scheduler:</strong><br>${$("adaptiveScheduler")?.checked?"Adaptativo":"Clássico"}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Confirmações falhadas:</strong><br>${sessionFailedConfirmations}</div>
    </div>
    <div class="small" style="margin-top:12px">
      Memória média atual: <strong>${avgMemory}%</strong><br>
      Acertos nesta sessão: <strong>${correctCount}</strong> · Erros/skip: <strong>${wrongCount}</strong>
    </div>
  `;
}

function showSessionComplete(){
  currentCard=null;
  const card=$("card");
  card.className="card revealed";
  card.innerHTML=sessionSummaryHtml();
  $("answerArea").classList.add("hidden");
  if($("voiceResult"))$("voiceResult").innerHTML="";
  renderStatsPage();
}

function buildPracticeQueue(){
const maxNew=Number($("maxNewWords")?$("maxNewWords").value:5);
const maxCards=Number($("maxCardsPerSession")?$("maxCardsPerSession").value:40);

const active=activeVocabulary();

const dueMastered = active
  .filter(w => (w.studyState==="mastered" || w.mastered) && isDueForReview(w))
  .sort((a,b)=>(a.nextReviewAt||0)-(b.nextReviewAt||0));

const confirmation = active.filter(w => isConfirmationState(w));

const critical = active.filter(w => isCritical(w) && !isConfirmationState(w));

const learning = active
  .filter(w => !w.mastered && !isConfirmationState(w) && !isCritical(w) && (w.studyState||"new")!=="new")
  .sort((a,b)=>(a.memoryLevel||0)-(b.memoryLevel||0));

const newWords = active.filter(w => (w.studyState||"new")==="new");

let selected=[];

selected.push(...confirmation);
selected.push(...critical);
selected.push(...learning);
selected.push(...dueMastered);

// equilíbrio cognitivo adaptativo
const recentFails = active.reduce((s,w)=>s+Math.max(0,(w.failCount||0)-(sessionInitialSnapshot[vocabulary.indexOf(w)]?.failCount||0)),0);

let targetUnique = 12;

// fadiga cognitiva:
// se há muitos erros recentes, reduz carga nova.
if(recentFails >= 5){
  targetUnique = 8;
}

if(recentFails >= 10){
  targetUnique = 6;
}

// Novas só entram se houver espaço cognitivo depois de revisão/aprendizagem.

const freeSlots=Math.max(0,targetUnique-selected.length);
selected.push(...newWords.slice(0,Math.min(maxNew,freeSlots)));

selected=[...new Set(selected)];

// Define quando cada palavra deve estar disponível dentro da sessão.
selected.forEach(w=>{
  if(isCritical(w)) setSessionDue(w,0);
  else if(isConfirmationState(w)) setSessionDue(w,1);
  else setSessionDue(w,0);
});

// Pool de palavras únicas. A função nextCard vai agendar repetições dinamicamente.
return selected.slice(0, Math.max(1, maxCards));
}

function startPractice(){takeSessionSnapshot();practiceQueue=buildPracticeQueue();correctCount=0;wrongCount=0;nextCard()}
function nextCard(){
revealed=false;
$("answerArea").classList.add("hidden");
if($("voiceResult"))$("voiceResult").innerHTML="";
const card=$("card");
card.className="card";

window.sessionCardCounter = (window.sessionCardCounter || 0) + 1;

// Se a palavra atual está em confirmação ou zona crítica, mantém repetição focada.
if(currentCard && (isConfirmationState(currentCard) || ($("repeatCriticalWords") && $("repeatCriticalWords").checked && isCritical(currentCard)))){
  card.innerHTML=currentCard.pt;
  updateStats();
  renderProgress();
  speakPortuguese(currentCard.pt);
  if(micMasterOn && isAutoMicMode()){
    scheduleAutoMic();
  }
  return;
}

if(practiceQueue.length===0){
  if(activeVocabulary().length){
    showSessionComplete();
  }else{
    currentCard=null;
    card.innerHTML="Não há palavras ativas para treinar";
    updateStats();
  }
  return;
}

// Escolhe apenas cartas cujo sessionDueAt já chegou.
let due = practiceQueue
  .map((c,i)=>({c,i}))
  .filter(x=>isSessionDue(x.c));

if(!due.length){
  // Se nada está vencido, escolhe a que vence mais cedo.
  due = practiceQueue
    .map((c,i)=>({c,i}))
    .sort((a,b)=>(a.c.sessionDueAt||0)-(b.c.sessionDueAt||0))
    .slice(0,1);
}

// Prioridade dentro da sessão.
due.sort((a,b)=>{
  const ac=a.c, bc=b.c;

  if(isConfirmationState(ac) && !isConfirmationState(bc)) return -1;
  if(!isConfirmationState(ac) && isConfirmationState(bc)) return 1;

  if(isCritical(ac) && !isCritical(bc)) return -1;
  if(!isCritical(ac) && isCritical(bc)) return 1;

  return (ac.memoryLevel||0)-(bc.memoryLevel||0);
});

const pick = due[0];
currentCard = pick.c;

// Remove esta ocorrência. Se precisar reaparecer, será re-agendada após a resposta.
practiceQueue.splice(pick.i,1);

currentCard.sessionAppearances=(currentCard.sessionAppearances||0)+1;

card.innerHTML=currentCard.pt;
updateStats();
renderProgress();
speakPortuguese(currentCard.pt);

if(micMasterOn && isAutoMicMode()){
  scheduleAutoMic();
}
}

function revealCard(){
if(!currentCard)return;
const card=$("card");
if(revealed){
  revealed=false;
  $("answerArea").classList.add("hidden");
  card.className="card";
  card.innerHTML=currentCard.pt;
  return;
}
revealed=true;
card.className="card revealed";
const ans=getAllAnswers(currentCard);
card.innerHTML=`<div class="answer-title">${formatGerman(currentCard.de)}</div><div><strong>Respostas aceites:</strong><br>${ans.join(" · ")}</div>${currentCard.sentence?`<div class="sentence">${currentCard.sentence}</div>`:""}<div class="small">Memória: ${Math.round(currentCard.memoryLevel||0)}% · ${memoryLabel(currentCard)}</div>`;
renderSynonymButtons(ans);
$("answerArea").classList.remove("hidden");
}
function renderSynonymButtons(ans){$("synonymButtons").innerHTML="";ans.forEach(a=>{const b=document.createElement("button");b.className="success";b.textContent="Acertei: "+a;b.onclick=()=>markCorrect(a);$("synonymButtons").appendChild(b)})}


function scoreValue(id,fallback){
 const el=$(id);
 return el?Number(el.value):fallback;
}

function masterThreshold(){
 return scoreValue("masterThreshold",85);
}
function minExposuresToMaster(){
 return scoreValue("minExposuresToMaster",5);
}
function minStreakToMaster(){
 return scoreValue("minStreakToMaster",3);
}

function minMemoryLevel(){
 const el=$("minMemoryLevel");
 return el?Number(el.value):-50;
}

function criticalThreshold(){
 const el=$("criticalThreshold");
 return el?Number(el.value):0;
}

function isCritical(word){
 return (word.memoryLevel||0) < criticalThreshold();
}


function nowTs(){
 return Date.now();
}

function daysToMs(days){
 return days*24*60*60*1000;
}

function minRepeatDistance(){
 const el=$("minRepeatDistance");
 return el?Number(el.value):3;
}

function initialReviewDays(){
 const el=$("initialReviewDays");
 return el?Number(el.value):1;
}

function reviewGrowthFactor(){
 const el=$("reviewGrowthFactor");
 return el?Number(el.value):2;
}

function isDueForReview(word){
 return !word.nextReviewAt || word.nextReviewAt <= nowTs();
}

function scheduleNextReview(word, success=true){
 word.lastReviewedAt = nowTs();
 word.totalReviews = (word.totalReviews||0)+1;

 const adaptive = $("adaptiveScheduler") && $("adaptiveScheduler").checked;

 if(success){

   // estabilidade aumenta lentamente com sucesso consistente
   word.stabilityScore = Math.min(100,
      (word.stabilityScore||0)
      + (word.mastered ? 12 : 6)
      + Math.max(0,(word.correctStreak||0)*1.5)
   );

   let current = word.reviewIntervalDays || initialReviewDays();
   let growth = reviewGrowthFactor();

   if(adaptive){

     // palavras difíceis crescem mais lentamente
     if(word.difficultyBoost) growth *= 0.7;

     // zona crítica recente
     if((word.memoryLevel||0) < 40) growth *= 0.8;

     // estabilidade elevada acelera crescimento
     if((word.stabilityScore||0) > 70) growth *= 1.4;

     // muitas falhas históricas abrandam
     const failPenalty = Math.min(0.4, (word.failCount||0)*0.02);
     growth *= (1-failPenalty);
   }

   const next = word.mastered
      ? Math.min(180, Math.max(initialReviewDays(), current * growth))
      : initialReviewDays();

   word.reviewIntervalDays = Math.round(next*10)/10;
   word.nextReviewAt = nowTs() + daysToMs(next);

 }else{

   // esquecimento reduz estabilidade
   word.stabilityScore = Math.max(0,
      (word.stabilityScore||0) - 18
   );

   word.reviewIntervalDays = 0;
   word.nextReviewAt = nowTs();
 }
}

function setSessionDue(word, cardsFromNow){
 word.sessionDueAt = (window.sessionCardCounter || 0) + cardsFromNow;
}

function isSessionDue(word){
 return !word.sessionDueAt || word.sessionDueAt <= (window.sessionCardCounter || 0);
}

function plannedRepeatDistance(word){
 if(isCritical(word)) return 0;
 if(isConfirmationState(word)) return 2;

 const mem = word.memoryLevel || 0;
 const stability = word.stabilityScore || 0;

 let dist = 3;

 if(mem < 20) dist = 1;
 else if(mem < 40) dist = 2;
 else if(mem < 60) dist = 4;
 else if(mem < 85) dist = 7;
 else dist = 12;

 // estabilidade alta afasta mais
 if(stability > 60) dist += 4;

 // difíceis reaparecem mais cedo
 if(word.difficultyBoost) dist = Math.max(1, dist-2);

 return Math.max(minRepeatDistance(), dist);
}


function memoryLabel(word){
 const mem=word.memoryLevel||0;
 if((word.studyState||"new")==="relearningConfirmation") return "Confirmação";
 if(word.studyState==="mastered" || word.mastered) return "Dominada";
 if(isCritical(word)) return "Zona crítica ativa ativa";
 if(mem>=75) return "Quase dominada";
 if(mem>=40) return "Aprendizagem";
 return "Nova/fraca";
}


function isConfirmationState(word){
 return (word.studyState||"new")==="relearningConfirmation";
}


var DT52_ARTICLES=["der","die","das","den","dem","des","ein","eine","einen","einem","einer"];

function dt52Tokens(s){
 return normalize(s||"").split(/\s+/).filter(Boolean);
}

function dt52Lev(a,b){
 a=a||""; b=b||"";
 const m=[];
 for(let i=0;i<=b.length;i++){m[i]=[i]}
 for(let j=0;j<=a.length;j++){m[0][j]=j}
 for(let i=1;i<=b.length;i++){
  for(let j=1;j<=a.length;j++){
   if(b.charAt(i-1)==a.charAt(j-1)) m[i][j]=m[i-1][j-1];
   else m[i][j]=Math.min(m[i-1][j-1]+1,m[i][j-1]+1,m[i-1][j]+1);
  }
 }
 return m[b.length][a.length];
}

function dt52Similarity(a,b){
 const d=dt52Lev(a,b);
 return 1-d/Math.max(a.length,b.length,1);
}

function dt52Classify(expected,spoken){
 const cleanSpoken = normalizeVoice(spoken || "");
 if(!cleanSpoken) return "memory";

 const e = dt52Tokens(expected);
 const s = dt52Tokens(spoken);

 // ARTICLE only when article differs and remaining content is almost identical.
 if(e.length && s.length){
   const e0=e[0], s0=s[0];
   if(DT52_ARTICLES.includes(e0) && DT52_ARTICLES.includes(s0) && e0 !== s0){
     const eRest=e.slice(1).join(" ");
     const sRest=s.slice(1).join(" ");
     if(eRest && sRest && dt52Similarity(eRest,sRest) >= 0.85) return "article";
   }
 }

 if(hasRequiredArticleMismatch(spoken, expected)){
   const eRest=e.slice(1).join(" ");
   const sRest=s.slice(1).join(" ");
   if(eRest && sRest && dt52Similarity(eRest,sRest) >= 0.85) return "article";
 }

 // GRAMMAR only when sentence/phrase has real overlap.
 const expectedSet=new Set(e);
 const spokenSet=new Set(s);
 let overlap=0;
 expectedSet.forEach(w=>{if(spokenSet.has(w)) overlap++;});
 const overlapRatio=overlap/Math.max(expectedSet.size,1);

 const sameWordsDifferentOrder =
   e.length===s.length && overlapRatio>=0.8 && e.join(" ")!==s.join(" ");

 let smallGrammarChange=false;
 if(e.length===s.length && e.length>=2 && overlapRatio>=0.5){
   let diff=0, shortDiff=false;
   for(let i=0;i<e.length;i++){
     if(e[i]!==s[i]){
       diff++;
       if(e[i].length<=5 || s[i].length<=5) shortDiff=true;
     }
   }
   smallGrammarChange = diff<=2 && shortDiff;
 }

 if(hasStrictGrammarMismatch(spoken, expected) && overlapRatio>=0.4) return "grammar";
 if(sameWordsDifferentOrder || smallGrammarChange) return "grammar";

 return "memory";
}

function dt52Penalty(type){
 if(type==="article") return scoreValue("memoryArticleError",-8);
 if(type==="grammar") return scoreValue("memoryGrammarError",-15);
 return scoreValue("memoryMemoryError",-25);
}


function clampValue(v,min,max){return Math.max(min,Math.min(max,v));}

function stabilityDeltaFor(type,success,due=false){
 if(success) return due ? scoreValue("stabilityDueCorrect",10) : scoreValue("stabilityCorrect",4);
 if(type==="article") return scoreValue("stabilityArticleError",-3);
 if(type==="grammar") return scoreValue("stabilityGrammarError",-6);
 return scoreValue("stabilityMemoryError",-12);
}

function xpDeltaFor(type,success,due=false,skip=false){
 if(skip) return scoreValue("xpSkip",0);
 if(success) return due ? scoreValue("xpDueCorrect",20) : scoreValue("xpCorrect",10);
 if(type==="article") return scoreValue("xpArticleError",4);
 if(type==="grammar") return scoreValue("xpGrammarError",3);
 return scoreValue("xpMemoryError",1);
}

function applyLearningMetrics(word,type,success,skip=false){
 const due=isDueForReview(word);
 word.stabilityScore=clampValue((word.stabilityScore||0)+stabilityDeltaFor(type,success,due),0,100);
 word.xp=Math.max(0,(word.xp||0)+xpDeltaFor(type,success,due,skip));
}

function setConfirmationState(word){
 word.studyState="relearningConfirmation";
 word.mastered=false;
 word.difficultyBoost=false;
 word.memoryLevel=Math.max(criticalThreshold()+5, Math.min(80, word.memoryLevel||75));
}

function recoverFromConfirmation(word){
 word.studyState="mastered";
 word.mastered=true;
 word.difficultyBoost=false;
 word.memoryLevel=Math.max(75, Math.min(90, word.memoryLevel||75));
 word.correctStreak=Math.max(word.correctStreak||0, minStreakToMaster());
}

function failConfirmation(word){
 word.studyState="learning";
 word.mastered=false;
 word.difficultyBoost=true;
 word.memoryLevel=Math.min(word.memoryLevel||0, criticalThreshold()-10);
}


function updateMemory(word,delta){
 const minLevel=minMemoryLevel();

 word.memoryLevel=Math.max(minLevel,Math.min(100,(word.memoryLevel||0)+delta));

 const enoughMemory = word.memoryLevel>=masterThreshold();
 const enoughStreak = (word.correctStreak||0)>=minStreakToMaster();
 const enoughExposure = (word.seenCount||0)>=minExposuresToMaster();

 if(enoughMemory && enoughStreak && enoughExposure){
   word.studyState="mastered";
   word.mastered=true;
 }else{
   if(word.studyState==="mastered"){
     word.studyState="learning";
   }
   word.mastered=false;

   if(word.studyState!=="new"){
     word.studyState="learning";
   }
 }
}

function registerCorrect(){
if(!currentCard)return false;
const idx=vocabulary.indexOf(currentCard);

if(idx>=0){
 const word=vocabulary[idx];

 const wasMastered = !!sessionInitialSnapshot[idx]?.mastered;
 const wasConfirmation = isConfirmationState(word);

 word.correctStreak=(word.correctStreak||0)+1;
 word.wrongStreak=0;
 word.successCount=(word.successCount||0)+1;
 word.seenCount=(word.seenCount||0)+1;

 if(wasConfirmation){
   recoverFromConfirmation(word);
   sessionRecoveredConfirmations++;
 }else{
   if(word.studyState==="new"){
     word.studyState="learning";
   }

   updateMemory(word,scoreValue("memoryCorrect",10));

   applyLearningMetrics(word,"memory",true,false);

   if(wasMastered && word.mastered){
     sessionMasteredRemembered++;
   }
 }

 if(word.correctStreak>=2){
   word.difficultyBoost=false;
 }

 if(word.mastered){
   scheduleNextReview(word,true);
 }

 // Se ainda não está dominada, agenda repetição dentro da sessão.
 if(!word.mastered && practiceQueue.length < Number($("maxCardsPerSession")?$("maxCardsPerSession").value:40)){
   setSessionDue(word, plannedRepeatDistance(word));
   practiceQueue.push(word);
 }

 saveVocabulary();

 return word.mastered;
}

return false;
}


function registerWrong(type="wrong", spokenText=""){
if(!currentCard)return;
const idx=vocabulary.indexOf(currentCard);

if(idx>=0){
 const word=vocabulary[idx];

 const wasMastered = !!word.mastered || (word.studyState==="mastered");
 const wasConfirmation = isConfirmationState(word);

 word.correctStreak=0;
 word.wrongStreak=(word.wrongStreak||0)+1;
 word.failCount=(word.failCount||0)+1;
 word.seenCount=(word.seenCount||0)+1;

 let errorType="memory";

 if(["memory","article","grammar","memory","recognition"].includes(type)){
   errorType = type;
 }else if(type==="skip"){
   errorType="memory";
 }else if(spokenText){
   errorType=dt52Classify(word.de, spokenText);
 }

 if(!word.errorStats){
   word.errorStats={memory:0,article:0,grammar:0};
 }
 if(word.errorStats[errorType]===undefined){
   word.errorStats[errorType]=0;
 }
 word.errorStats[errorType]++;

 if(wasConfirmation){
   failConfirmation(word);
   sessionFailedConfirmations++;
 }else if(wasMastered){
   setConfirmationState(word);
   sessionMasteredForgotten++;
 }else{
   word.studyState="learning";
   word.mastered=false;

   updateMemory(word,dt52Penalty(errorType));

   applyLearningMetrics(word,errorType,false,type==="skip");

   if(errorType==="memory" || errorType==="grammar"){
      word.difficultyBoost=true;
   }
 }

 scheduleNextReview(word,false);

 if(practiceQueue.length < Number($("maxCardsPerSession")?$("maxCardsPerSession").value:40)){
   setSessionDue(word, plannedRepeatDistance(word));
   practiceQueue.push(word);
 }

 if($("voiceResult")){
   let reason = "";

   if(errorType==="article"){
     reason = "erro de artigo";
   }else if(errorType==="grammar"){
     reason = "estrutura semelhante com pequena diferença";
   }else{
     reason = "estrutura não recuperada / resposta diferente";
   }

   $("voiceResult").innerHTML += `<div class="small" style="margin-top:6px;color:#b91c1c">Diagnóstico: ${errorType} · ${reason}</div>`;
 }

 saveVocabulary();
}
}

function markKnownBySwipe(){if(!currentCard)return;correctCount++;speakGerman(currentCard.de);const masteredNow=registerCorrect();removeCurrentFromQueue();$("card").className="card green revealed";$("card").innerHTML=masteredNow?`<div class="answer-title">Dominada ✅</div><div>${formatGerman(currentCard.de)}</div><div class="small">Memória consolidada. Esta palavra passa para revisão ocasional.</div>`:`<div class="answer-title">Já sei ✅</div><div>${formatGerman(currentCard.de)}</div><div class="small">Memória: ${Math.round(currentCard.memoryLevel||0)}%</div>`;setTimeout(nextCard,masteredNow?2200:1800)}
function markCorrect(a){if(!currentCard)return;correctCount++;speakGerman(a);const masteredNow=registerCorrect();removeCurrentFromQueue();$("card").className="card green revealed";$("card").innerHTML=masteredNow?`<div class="answer-title">Dominada ✅</div><div>${formatGerman(a)}</div><div class="small">Memória consolidada. Esta palavra passa para revisão ocasional.</div>`:`<div class="answer-title">Correto ✅</div><div>${formatGerman(a)}</div><div class="small">Memória: ${Math.round(currentCard.memoryLevel||0)}%</div>`;setTimeout(nextCard,masteredNow?2200:1800)}
function markWrong(){if(!currentCard)return;wrongCount++;speakGerman(currentCard.de);registerWrong("skip","");$("card").className="card red revealed";$("card").innerHTML=`<div class="answer-title">Errado ❌</div><div>A resposta era: <strong>${formatGerman(currentCard.de)}</strong></div><div class="small">Memória atualizada: ${Math.round(currentCard.memoryLevel||0)}%</div>${currentCard.sentence?`<div class="sentence">${currentCard.sentence}</div>`:""}`;setTimeout(nextCard,2200)}
function skipCard(){if(!currentCard)return;wrongCount++;speakGerman(currentCard.de);registerWrong("skip","");$("card").className="card red revealed";$("card").innerHTML=`<div class="answer-title">Skip ⏭️</div><div>A resposta era: <strong>${formatGerman(currentCard.de)}</strong></div><div class="small">Memória atualizada: ${Math.round(currentCard.memoryLevel||0)}%</div>${currentCard.sentence?`<div class="sentence">${currentCard.sentence}</div>`:""}`;setTimeout(nextCard,2200)}
function removeCurrentFromQueue(){
  // A carta já foi consumida pela seleção em nextCard().
  // Mantemos as restantes repetições planeadas para reforço inteligente.
}
function progressLevel(streak){
  if(streak >= MASTER_LIMIT) return "done";
  if(streak >= 5) return "high";
  if(streak >= 3) return "mid";
  return "low";
}

function renderProgress(){
  const box=$("progressBox");
  if(!box || !currentCard){ if(box) box.innerHTML=""; return; }
  const streak=currentCard.correctStreak||0;
  const mem=Math.round(currentCard.memoryLevel||0);
  const label=memoryLabel(currentCard);
  const state=currentCard.studyState||"new";
  const hard=currentCard.difficultyBoost ? `<span class="hardBadge">difícil</span>` : "";
  let level="low";
  if(mem>=85) level="done"; else if(mem>=70) level="high"; else if(mem>=40) level="mid";
  let dots="";
  const filled=Math.round((mem/100)*MASTER_LIMIT);
  for(let i=1;i<=MASTER_LIMIT;i++) dots+=`<span class="dot ${i<=filled ? "on "+level : ""}">●</span>`;
  box.innerHTML=`<div class="progressDots">${dots}</div><div class="progressText">${label} · Memória ${mem}% ${isCritical(currentCard)?"· zona crítica":""} · acertos seguidos ${streak} · ${state} ${hard}</div>`;
}

function updateStats(){
const mastered=vocabulary.filter(x=>x.mastered).length, active=activeVocabulary().length, hard=vocabulary.filter(x=>x.difficultyBoost&&!x.mastered).length;
$("stats").textContent=`${active} ativas · ${mastered} dominadas · ${hard} difíceis · ${practiceQueue.length} cartões nesta sessão · ${correctCount} certas · ${wrongCount} falhadas/skip`;
renderProgress();
}

function renderWordList(){
const q=normalize($("searchBox")?.value||""),sort=$("sortMode")?.value||"recent";let list=vocabulary.map((item,index)=>({item,index}));
if(q) list=list.filter(x=>[x.item.pt,x.item.de,(x.item.synonyms||[]).join(" "),x.item.sentence||""].some(v=>normalize(v).includes(q)));
if(sort==="pt") list.sort((a,b)=>a.item.pt.localeCompare(b.item.pt));else if(sort==="de") list.sort((a,b)=>a.item.de.localeCompare(b.item.de));else if(sort==="mastered") list.sort((a,b)=>(b.item.mastered?1:0)-(a.item.mastered?1:0));else list.sort((a,b)=>(b.item.createdAt||0)-(a.item.createdAt||0));

const avgMemory = vocabulary.length ? Math.round(vocabulary.reduce((s,w)=>s+(w.memoryLevel||0),0)/vocabulary.length) : 0;
const dueNow = vocabulary.filter(w=>isDueForReview(w) && (w.mastered || w.studyState==="mastered")).length;
const criticalNow = vocabulary.filter(w=>isCritical(w)).length;

$("dbCount").textContent=`${list.length} de ${vocabulary.length} palavras · ${activeVocabulary().length} em aprendizagem · ${vocabulary.filter(x=>x.mastered).length} em revisão ocasional · Memory média ${avgMemory}% · ${dueNow} revisões vencidas · ${criticalNow} críticas`;

if(!list.length){$("wordList").innerHTML="<p class='small'>Sem resultados.</p>";return}
$("wordList").innerHTML="";
list.forEach(({item,index})=>{
const div=document.createElement("div");
div.className="item";
const stateLabel =
item.learningState==="suspended" ? "Suspensa" :
item.learningState==="focus" ? "Foco ativo" :
item.learningState==="mastered" || item.mastered ? "Dominada manual" :
"Automático";
div.innerHTML=`<div class="item-title">${item.pt} → ${formatGerman(item.de)}</div>
<div>
<span class="pill">${stateLabel}</span>
<span class="pill">Memory ${Math.round(item.memoryLevel||0)}%</span>
<span class="pill">Stability ${Math.round(item.stabilityScore||0)}%</span>
<span class="pill">XP ${Math.round(item.xp||0)}</span>
<span class="pill">Acertos ${item.successCount||0}</span>
<span class="pill">Erros ${item.failCount||0}</span>
${item.difficultyBoost&&!item.mastered?'<span class="pill" style="background:#fee2e2;color:#991b1b">Palavra difícil</span>':''}
</div>
<div>
<span class="pill">Erro memória ${Number(item.errorStats?.memory||0)}</span>
<span class="pill">Artigos ${Number(item.errorStats?.article||0)}</span>
<span class="pill">Gramática ${Number(item.errorStats?.grammar||0)}</span>
<span class="pill">Próxima revisão ${item.nextReviewAt?new Date(item.nextReviewAt).toLocaleDateString():"—"}</span>
</div>
${item.synonyms?.length?`<div>${item.synonyms.map(s=>`<span class="pill">${s}</span>`).join("")}</div>`:""}
${item.sentence?`<div class="small">${item.sentence}</div>`:""}
<div class="actions"><button class="secondary" data-edit="${index}">Editar</button><button class="danger" data-del="${index}">Apagar</button></div>`;
$("wordList").appendChild(div)
});
document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editWord(Number(b.dataset.edit)));document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>deleteWord(Number(b.dataset.del)));
}

function getSeparator(){return $("separator").value==="tab"?"\t":$("separator").value}
function splitLine(line,sep){let r=[],c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i],n=line[i+1];if(ch=='"'&&n=='"'){c+='"';i++}else if(ch=='"'){q=!q}else if(ch===sep&&!q){r.push(c.trim());c=""}else c+=ch}r.push(c.trim());return r}

function importJsonBackup(e){
  const file = e.target.files[0];
  if(!file) return;

  const reader = new FileReader();

  reader.onload = function(ev){
    try{
      const data = JSON.parse(ev.target.result);
      const words = Array.isArray(data) ? data : data.vocabulary;

      if(!Array.isArray(words)){
        throw new Error("invalid");
      }

      vocabulary = words.map(w => ({
        pt: w.pt || "",
        de: w.de || "",
        synonyms: w.synonyms || [],
        sentence: w.sentence || "",
        correctStreak: w.correctStreak || 0,
        wrongStreak: w.wrongStreak || 0,
        difficultyBoost: !!w.difficultyBoost,
        mastered: !!w.mastered,
learningState:$("learningState") ? $("learningState").value : "auto",
        memoryLevel: w.memoryLevel || 0,
        studyState: w.studyState || (w.mastered ? "mastered" : "new"),
        successCount: w.successCount || 0,
        failCount: w.failCount || 0,
        seenCount: w.seenCount || 0,
        errorStats: w.errorStats || {memory:0,article:0,grammar:0}
      })).filter(w => w.pt && w.de);

      saveVocabulary();
      renderWordList();
      startPractice();

      $("importResult").innerHTML = "<strong>Backup JSON importado com sucesso.</strong>";
    }catch(err){
      $("importResult").innerHTML = "<strong>JSON inválido.</strong>";
    }

    e.target.value = "";
  };

  reader.readAsText(file, "UTF-8");
}

function loadImportFile(e){const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=x=>{$("bulkText").value=x.target.result;$("importResult").innerHTML="Ficheiro carregado. Clica em Importar."};reader.readAsText(f,"UTF-8")}
function importBulkText(){
const text=$("bulkText").value.trim(),sep=getSeparator(),mode=$("importMode") ? $("importMode").value : "add";
if(!text){alert("Cola texto ou carrega um ficheiro.");return}
let imported=0,skipped=0,dups=0,updated=0;
text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach((line,i)=>{
  const p=splitLine(line,sep);
  if(i===0&&p[0]&&p[0].toLowerCase().includes("portugu")){skipped++;return}
  const pt=(p[0]||"").trim(),de=(p[1]||"").trim(),syn=parseSynonyms(p[2]||""),sentence=(p[3]||"").trim();
  if(!pt||!de){skipped++;return}
  const existingIndex=findBestExistingIndex(pt,de,syn);
  if(existingIndex>=0){
    if(mode==="update"){
      const old=vocabulary[existingIndex];
      vocabulary[existingIndex]={
        ...old,
        pt: pt || old.pt,
        de: de || old.de,
        synonyms: mergeSynonyms(old.synonyms, syn),
        sentence: sentence || old.sentence || "",
        updatedAt: Date.now()
      };
      updated++;
    }else{
      dups++;
      skipped++;
    }
    return;
  }
  vocabulary.push({pt,de,synonyms:syn,sentence,createdAt:Date.now(),updatedAt:Date.now(),
sessionDueAt:0,correctStreak:0,wrongStreak:0,difficultyBoost:false,mastered:false});
  imported++;
});
saveVocabulary();renderWordList();startPractice();
$("importResult").innerHTML=`<strong>${imported}</strong> novas. <strong>${updated}</strong> atualizadas. <strong>${dups}</strong> duplicados ignorados. <strong>${skipped}</strong> linhas ignoradas.`;
$("bulkText").value="";$("fileInput").value="";
}
function csvEscape(v){v=(v||"").toString();return /[;"\n,]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCsv(){const lines=["Português;Alemão;Sinónimos;Frase;Memória;Estado;Acertos;Erros;Difícil;Dominada",...vocabulary.map(x=>[x.pt,x.de,(x.synonyms||[]).join(", "),x.sentence||"",Math.round(x.memoryLevel||0),x.studyState||"new",x.successCount||0,x.failCount||0,x.difficultyBoost?"sim":"não",x.mastered?"sim":"não"].map(csvEscape).join(";"))];downloadFile("vocabulario_deutsch_trainer.csv",lines.join("\n"),"text/csv")}
function exportJson(){downloadFile("vocabulario_deutsch_trainer.json",JSON.stringify(vocabulary,null,2),"application/json")}
function downloadTemplate(){downloadFile("modelo_vocabulario_alemao.csv","Português;Alemão;Sinónimos;Frase\ncasa;das Haus;Haus, Zuhause;Ich gehe nach Hause.\n","text/csv")}
function downloadFile(name,content,type){const blob=new Blob([content],{type:type+";charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}

function backupFilename(ext){
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  return `deutsch-trainer-backup-${stamp}.${ext}`;
}
function createBackupJson(){
  const backup = {app:"Deutsch Trainer",version:"10.1",createdAt:new Date().toISOString(),vocabulary};
  downloadFile(backupFilename("json"), JSON.stringify(backup,null,2), "application/json");
  changesSinceBackup=0;
  localStorage.setItem("changesSinceBackup","0");
  localStorage.setItem("lastBackupAt",new Date().toISOString());
  updateBackupInfo();
}
function createBackupCsv(){
  exportCsv();
  changesSinceBackup=0;
  localStorage.setItem("changesSinceBackup","0");
  localStorage.setItem("lastBackupAt",new Date().toISOString());
  updateBackupInfo();
}
function updateBackupInfo(){
  const el=$("lastBackupInfo");
  if(!el)return;
  const last=localStorage.getItem("lastBackupAt");
  const changes=Number(localStorage.getItem("changesSinceBackup")||changesSinceBackup||0);
  el.innerHTML=`Alterações desde o último backup: <strong>${changes}</strong>${last?`<br>Último backup: ${new Date(last).toLocaleString()}`:"<br>Ainda sem backup registado neste dispositivo."}`;
}
function maybeShowBackupReminder(){
  if(!$("backupReminder") || !$("backupReminder").checked)return;
  const changes=Number(localStorage.getItem("changesSinceBackup")||0);
  if(changes>=25) alert("Tens muitas alterações desde o último backup. Considera criar um backup JSON e guardar no iCloud Drive.");
}


function renderStatsPage(){
  const total = vocabulary.length;
  const active = activeVocabulary().length;
  const mastered = vocabulary.filter(x=>x.mastered || x.learningState==="mastered").length;
  const suspended = vocabulary.filter(x=>x.learningState==="suspended").length;
  const focus = vocabulary.filter(x=>x.learningState==="focus").length;
  const difficult = vocabulary.filter(x=>x.difficultyBoost && !x.mastered).length;
  const critical = vocabulary.filter(x=>isCritical(x)).length;
  const confirmation = vocabulary.filter(x=>isConfirmationState(x)).length;
  const dueNow = vocabulary.filter(x=>isDueForReview(x) && (x.mastered || x.studyState==="mastered")).length;

  const avgMemory = total ? Math.round(vocabulary.reduce((s,w)=>s+(w.memoryLevel||0),0)/total) : 0;
  const avgStability = total ? Math.round(vocabulary.reduce((s,w)=>s+(w.stabilityScore||0),0)/total) : 0;
  const totalXP = Math.round(vocabulary.reduce((s,w)=>s+(w.xp||0),0));

  const errorTotals = {memory:0,article:0,grammar:0};
  vocabulary.forEach(w=>{
    const e=w.errorStats||{};
    errorTotals.memory += Number(e.memory||0);
    errorTotals.article += Number(e.article||0);
    errorTotals.grammar += Number(e.grammar||0);
  });
  const totalErrors = errorTotals.memory + errorTotals.article + errorTotals.grammar;
  const topError = Object.entries(errorTotals).sort((a,b)=>b[1]-a[1])[0];

  const der = vocabulary.filter(x=>/^der\s+/i.test(x.de || "")).length;
  const die = vocabulary.filter(x=>/^die\s+/i.test(x.de || "")).length;
  const das = vocabulary.filter(x=>/^das\s+/i.test(x.de || "")).length;
  const noArticle = vocabulary.filter(x=>! /^(der|die|das)\s+/i.test(x.de || "")).length;

  const hardest = vocabulary
    .filter(w=>(w.failCount||0)>0 || w.difficultyBoost || isCritical(w))
    .sort((a,b)=>((b.failCount||0)+(b.errorStats?.grammar||0)+(b.errorStats?.article||0))-((a.failCount||0)+(a.errorStats?.grammar||0)+(a.errorStats?.article||0)))
    .slice(0,10);

  const weak = vocabulary.slice().sort((a,b)=>(a.memoryLevel||0)-(b.memoryLevel||0)).slice(0,10);

  $("statsPageContent").innerHTML = `
    <div class="grid2">
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Total:</strong><br>${total}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Aprendizagem:</strong><br>${active}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Dominadas manuais:</strong><br>${mastered}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Foco ativo:</strong><br>${focus}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Suspensas:</strong><br>${suspended}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Palavras difíceis:</strong><br>${difficult}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Zona crítica ativa:</strong><br>${critical}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Confirmação:</strong><br>${confirmation}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Revisões vencidas:</strong><br>${dueNow}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Memory média:</strong><br>${avgMemory}%</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Stability média:</strong><br>${avgStability}%</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>XP total:</strong><br>${totalXP}</div>
      <div class="box" style="box-shadow:none;background:#f8fafc"><strong>Principal erro:</strong><br>${topError?topError[0]+" ("+topError[1]+")":"—"}</div>
    </div>

    <div class="box" style="box-shadow:none;background:#f8fafc">
      <h3>Tipos de erro</h3>
      <span class="pill">Memória: ${errorTotals.memory}</span>
      <span class="pill">Artigos: ${errorTotals.article}</span>
      <span class="pill">Gramática: ${errorTotals.grammar}</span>
      <br><span class="small">Total de erros classificados: ${totalErrors}</span>
    </div>

    <div class="box" style="box-shadow:none;background:#f8fafc">
      <h3>Artigos na base</h3>
      <span class="pill">der: ${der}</span>
      <span class="pill">die: ${die}</span>
      <span class="pill">das: ${das}</span>
      <span class="pill">sem artigo: ${noArticle}</span>
    </div>

    <div class="box" style="box-shadow:none;background:#f8fafc">
      <h3>Top palavras difíceis</h3>
      ${hardest.length ? hardest.map(w=>`<div class="item"><strong>${w.pt}</strong> → ${formatGerman(w.de)}<br><span class="small">Memory: ${Math.round(w.memoryLevel||0)}% · Stability: ${Math.round(w.stabilityScore||0)}% · XP: ${Math.round(w.xp||0)} · Erros: ${w.failCount||0}</span></div>`).join("") : "<p class='small'>Ainda não há palavras difíceis.</p>"}
    </div>

    <div class="box" style="box-shadow:none;background:#f8fafc">
      <h3>Memory mais fraca</h3>
      ${weak.length ? weak.map(w=>`<div class="item"><strong>${w.pt}</strong> → ${formatGerman(w.de)}<br><span class="small">Memory: ${Math.round(w.memoryLevel||0)}% · Estado: ${memoryLabel(w)}</span></div>`).join("") : "<p class='small'>Sem dados.</p>"}
    </div>
  `;
}

function setupSwipe(){const card=$("card");card.addEventListener("click",revealCard);card.addEventListener("touchstart",e=>{if(!currentCard)return;touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;touchCurrentX=touchStartX;isDragging=true},{passive:true});card.addEventListener("touchmove",e=>{if(!isDragging||!currentCard)return;touchCurrentX=e.touches[0].clientX;const dx=touchCurrentX-touchStartX,dy=e.touches[0].clientY-touchStartY;if(Math.abs(dy)>Math.abs(dx))return;if(dx<-30){card.classList.add("swipe-left");card.classList.remove("swipe-right")}else if(dx>30){card.classList.add("swipe-right");card.classList.remove("swipe-left")}else card.classList.remove("swipe-left","swipe-right")},{passive:true});card.addEventListener("touchend",()=>{if(!isDragging||!currentCard)return;const dx=touchCurrentX-touchStartX;isDragging=false;card.classList.remove("swipe-left","swipe-right");if(dx<=-swipeThreshold)markKnownBySwipe();else if(dx>=swipeThreshold)markWrong()});document.addEventListener("keydown",e=>{if(!currentCard)return;if(e.key==="ArrowLeft")markKnownBySwipe();if(e.key==="ArrowRight")markWrong()})}

document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>switchPage(t.dataset.page));
$("saveBtn").onclick=saveWord;$("resetLearningBtn").onclick=resetLearningForCurrentEdit;$("cancelEditBtn").onclick=clearForm;$("wrongBtn").onclick=markWrong;$("skipBtn").onclick=skipCard;$("restartBtn").onclick=startPractice;$("clearBtn").onclick=clearAllWords;$("micBtn").onclick=startVoiceRecognition;
$("fileInput").onchange=loadImportFile;$("jsonInput").onchange=importJsonBackup;$("importBtn").onclick=importBulkText;$("templateBtn").onclick=downloadTemplate;$("exportCsvBtn").onclick=exportCsv;$("exportJsonBtn").onclick=exportJson;$("backupJsonBtn").onclick=createBackupJson;$("backupCsvBtn").onclick=createBackupCsv;
["ptWord","deWord","synonyms"].forEach(id=>$(id).addEventListener("input",renderDuplicateWarning));
$("searchBox").oninput=renderWordList;$("sortMode").onchange=renderWordList;
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js"))}
loadVocabulary();setupSwipe();renderWordList();startPractice();updateBackupInfo();setTimeout(maybeShowBackupReminder,1000);

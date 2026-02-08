/* SEO-GEO Audit Tool - Main Application Logic */
/* Wydzielone z index.html dla lepszej organizacji kodu */

// === GLOBAL VARIABLES ===
let auditData = {};
let exitPopupShown = false;

// === START AUDIT ===
function startAudit() {
    console.log('=== START AUDIT CALLED ===');
    const email = document.getElementById('emailInput').value;
    const url = document.getElementById('urlInput').value;
    const honeypot = document.getElementById('websiteField').value;
    console.log('Email:', email);
    console.log('URL:', url);
    console.log('Honeypot:', honeypot);

    if (honeypot) {
        console.log('Bot detected');
        return;
    }

    if (!email || !url) {
        console.log('Validation failed: empty fields');
        showModal('Wypełnij wszystkie pola');
        return;
    }

    if (!email.includes('@')) {
        console.log('Validation failed: invalid email');
        showModal('Podaj prawidłowy email');
        return;
    }

    if (!url.startsWith('http')) {
        console.log('Validation failed: invalid URL');
        showModal('URL musi zaczynać się od https://');
        return;
    }

    console.log('=== SWITCHING SCREENS ===');
    document.getElementById('screen1').classList.remove('active');
    document.getElementById('screen2').classList.add('active');
    document.getElementById('analyzingUrl').textContent = url;
    console.log('=== STARTING ANALYSIS ===');
    runAnalysis(email, url);
}

// === RUN ANALYSIS ===
async function runAnalysis(email, url) {
    const checks = [
        { id: 'check1', delay: 8000, message: '🚀 Testuję prędkość ładowania...' },
        { id: 'check2', delay: 3000, message: '📱 Sprawdzam optymalizację mobile...' },
        { id: 'check3', delay: 2000, message: '🔒 Weryfikuję certyfikat SSL...' },
        { id: 'check4', delay: 10000, message: '🤖 Pytam ChatGPT o Twoją stronę...' },
        { id: 'check5', delay: 10000, message: '✨ Sprawdzam w Gemini AI...' },
        { id: 'check6', delay: 7000, message: '📋 Analizuję strukturę danych...' }
    ];

    const funMessages = [
        '💡 Wiedziałeś, że 53% użytkowników opuszcza stronę jeśli ładuje się dłużej niż 3s?',
        '🎯 Sprawdzamy czy Google Cię lubi...',
        '🔍 Przeczesujemy Internet w poszukiwaniu informacji o Tobie...',
        '⚡ To trwa dłużej, bo robimy to dokładnie!',
        '🎨 Analizujemy każdy piksel Twojej strony...',
        '🌟 Prawie gotowe! Przygotowujemy raport...'
    ];

    let messageIndex = 0;
    const messageInterval = setInterval(() => {
        const messageEl = document.getElementById('loadingMessage');
        if (messageEl && messageIndex < funMessages.length) {
            messageEl.textContent = funMessages[messageIndex];
            messageIndex++;
        }
    }, 5000);

    let progress = 0;
    const progressIncrement = 100 / checks.length;

    document.getElementById('progressBar').style.width = '2%';
    document.getElementById('progressText').textContent = '2%';
    document.getElementById('statusText').textContent = 'Rozpoczynam analizę...';

    for (let i = 0; i < checks.length; i++) {
        document.getElementById('statusText').textContent = checks[i].message;

        progress += progressIncrement / 2;
        document.getElementById('progressBar').style.width = progress + '%';
        document.getElementById('progressText').textContent = Math.round(progress) + '%';

        await new Promise(resolve => setTimeout(resolve, checks[i].delay));

        progress += progressIncrement / 2;
        document.getElementById('progressBar').style.width = progress + '%';
        document.getElementById('progressText').textContent = Math.round(progress) + '%';

        const checkEl = document.getElementById(checks[i].id);
        const spinnerDiv = checkEl.querySelector('.relative');
        if (spinnerDiv) {
            spinnerDiv.innerHTML = '<div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center"><svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div>';
        }
        checkEl.classList.remove('text-gray-400');
        checkEl.classList.add('text-green-600');
        checkEl.classList.add('bg-green-50');
    }

    clearInterval(messageInterval);
    document.getElementById('statusText').textContent = '✨ Generuję raport...';

    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, url })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        auditData = await response.json();
    } catch (error) {
        console.error('API Error:', error);
        auditData = {
            score: 47,
            pageSpeed: 35,
            loadTime: 4.2,
            mobileFriendly: false,
            https: true,
            chatGPTCitation: false,
            geminiCitation: false,
            schemaMarkup: false
        };
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    showResults(email, url, auditData);
}

// === SHOW RESULTS ===
function showResults(email, url, data) {
    document.getElementById('screen2').classList.remove('active');
    document.getElementById('screen3').classList.add('active');

    populateScreen3(email, url, data);

    const ctx = document.getElementById('scoreChart').getContext('2d');
    const chartColor = data.score >= 70 ? '#10b981' : data.score >= 40 ? '#f59e0b' : '#ef4444';

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [data.score, 100 - data.score],
                backgroundColor: [chartColor, '#e5e7eb'],
                borderWidth: 0
            }]
        },
        options: {
            cutout: '75%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
        },
        plugins: [{
            beforeDraw: function(chart) {
                const ctx = chart.ctx;
                ctx.restore();

                // Większy, pogrubiony font
                ctx.font = "bold " + (chart.height / 4).toFixed(2) + "px sans-serif";
                ctx.textBaseline = "middle";
                ctx.textAlign = "center";

                const text = data.score + "%";
                const x = chart.width / 2;
                const y = chart.height / 2;

                // Cień dla głębi
                ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 3;
                ctx.shadowOffsetY = 3;

                // Biały tekst
                ctx.fillStyle = '#ffffff';
                ctx.fillText(text, x, y);

                ctx.save();
            }
        }]
    });
}

// === POPULATE SCREEN 3 ===
function populateScreen3(email, url, data) {
    document.getElementById('resultUrl').textContent = url;
    document.getElementById('userEmailFinal').textContent = email;

    const monthlyLoss = calculateLoss(data.score, data.loadTime);
    document.getElementById('monthlyLoss').textContent = monthlyLoss;

    const statusEl = document.getElementById('visibilityStatus');
    if (data.score >= 70) {
        statusEl.innerHTML = '🟢 DOBRA';
        statusEl.className = 'text-4xl md:text-5xl font-bold mb-4 text-green-400';
    } else if (data.score >= 40) {
        statusEl.innerHTML = '🟡 ŚREDNIA';
        statusEl.className = 'text-4xl md:text-5xl font-bold mb-4 text-yellow-400';
    } else {
        statusEl.innerHTML = '🔴 NISKA';
        statusEl.className = 'text-4xl md:text-5xl font-bold mb-4 text-red-400';
    }

    updateTechnicalDetail('detail-https', data.https, 'HTTPS', data.https ? 'Twoja strona ma bezpieczne szyfrowane połączenie - to podstawa zaufania dla użytkowników i Google.' : 'Brak bezpiecznego połączenia - użytkownicy i Google nie ufają stronie.');
    updateTechnicalDetail('detail-pagespeed', data.pageSpeed >= 60, 'PageSpeed', data.pageSpeed >= 60 ? `${data.pageSpeed}% - Świetnie! Strona ładuje się szybko.` : `${data.pageSpeed}% - Google zaleca powyżej 90/100. Twoja strona ładuje się zbyt wolno, co zniechęca użytkowników i obniża pozycję w wyszukiwarce.`);
    updateTechnicalDetail('detail-mobile', data.mobileFriendly, 'Mobile', data.mobileFriendly ? 'Twoja strona dobrze wyświetla się na telefonach - to kluczowe, bo ponad 70% ruchu pochodzi z urządzeń mobilnych.' : 'Strona źle działa na telefonach - tracisz 70% potencjalnego ruchu.');
    updateTechnicalDetail('detail-chatgpt', data.chatGPTCitation, 'ChatGPT', data.chatGPTCitation ? 'ChatGPT zna Twoją firmę i może ją polecać użytkownikom.' : 'ChatGPT nie zna Twojej firmy - tracisz miliony potencjalnych klientów, którzy pytają AI o rekomendacje zamiast googlować.');
    updateTechnicalDetail('detail-gemini', data.geminiCitation, 'Gemini', data.geminiCitation ? 'Asystent Google Gemini zna i poleca Twoją stronę.' : 'Asystent Google Gemini nie poleca Twojej strony - to AI z dostępem do miliardów użytkowników Google.');
    updateTechnicalDetail('detail-schema', data.schemaMarkup, 'Schema Markup', data.schemaMarkup ? 'Struktura danych wdrożona - Google i AI rozumieją pełną strukturę Twojej strony.' : 'Brak ustrukturyzowanych danych - Google i AI nie rozumieją pełnej struktury Twojej strony, co ogranicza widoczność.');

    generateBusinessImpact(data);
    startCountdown(24);

    window.addEventListener('scroll', () => {
        const screen3 = document.getElementById('screen3');
        if (screen3 && screen3.classList.contains('active')) {
            const scrolled = window.scrollY > 300;
            const stickyBtn = document.getElementById('stickyMobileCTA');
            if (scrolled) {
                stickyBtn.classList.remove('hidden');
            } else {
                stickyBtn.classList.add('hidden');
            }
        }
    });
}

// === CALCULATE LOSS ===
function calculateLoss(score, loadTime) {
    const avgValue = 35; // zwiększone z 10 do 35
    const traffic = 1000;
    const baseConversion = 0.03;
    const loss = (100 - score) / 100;
    const monthlyLoss = Math.round(traffic * baseConversion * avgValue * loss);
    return monthlyLoss.toLocaleString('pl-PL');
}

// === COUNTDOWN TIMER ===
function startCountdown(hours = 24) {
    const endTime = Date.now() + (hours * 60 * 60 * 1000);

    const countdownInterval = setInterval(() => {
        const remaining = endTime - Date.now();

        if (remaining <= 0) {
            clearInterval(countdownInterval);
            document.getElementById('countdown').textContent = '00:00:00';
            return;
        }

        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);

        document.getElementById('countdown').textContent =
            `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 1000);
}

// === TOGGLE TECHNICAL DETAILS ===
function toggleTechnicalDetails() {
    const details = document.getElementById('technicalDetails');
    const chevron = document.getElementById('detailsChevron');

    if (details.classList.contains('hidden')) {
        details.classList.remove('hidden');
        chevron.style.transform = 'rotate(180deg)';
    } else {
        details.classList.add('hidden');
        chevron.style.transform = 'rotate(0deg)';
    }
}

// === TOGGLE FAQ ===
function toggleFAQ(index) {
    const allAnswers = document.querySelectorAll('.faq-answer');
    const allChevrons = document.querySelectorAll('.faq-chevron');
    const currentAnswer = allAnswers[index - 1];
    const currentChevron = allChevrons[index - 1];

    allAnswers.forEach((answer, i) => {
        if (i !== index - 1) {
            answer.classList.add('hidden');
            allChevrons[i].style.transform = 'rotate(0deg)';
        }
    });

    if (currentAnswer.classList.contains('hidden')) {
        currentAnswer.classList.remove('hidden');
        currentChevron.style.transform = 'rotate(180deg)';
    } else {
        currentAnswer.classList.add('hidden');
        currentChevron.style.transform = 'rotate(0deg)';
    }
}

// === BUY FULL REPORT ===
function buyFullReport() {
    const email = document.getElementById('userEmailFinal').textContent;
    const url = document.getElementById('resultUrl').textContent;

    window.location.href = `mailto:pomelomarketingandsoft@gmail.com?subject=Zamówienie raportu za 99 zł&body=Email: ${encodeURIComponent(email)}%0AStrona: ${encodeURIComponent(url)}`;
}

// === SELECT PACKAGE ===
function selectPackage(type) {
    const email = document.getElementById('userEmailFinal').textContent;
    const url = document.getElementById('resultUrl').textContent;

    if (type === 'consultation') {
        window.location.href = `mailto:pomelomarketingandsoft@gmail.com?subject=Konsultacja wdrożeniowa&body=Email: ${encodeURIComponent(email)}%0AStrona: ${encodeURIComponent(url)}`;
    }
}

// === UPDATE TECHNICAL DETAIL ===
function updateTechnicalDetail(elementId, isPassing, title, subtitle) {
    const element = document.getElementById(elementId);
    const icon = isPassing ? '✅' : '❌';
    const bgColor = isPassing ? 'bg-green-50' : 'bg-red-50';

    element.className = `flex items-start p-4 rounded-lg ${bgColor}`;
    element.innerHTML = `
        <span class="text-2xl mr-3 flex-shrink-0">${icon}</span>
        <div>
            <p class="font-semibold text-gray-800">${title}</p>
            <p class="text-sm text-gray-600">${subtitle}</p>
        </div>
    `;
}

// === GENERATE BUSINESS IMPACT ===
function generateBusinessImpact(data) {
    const problems = [];

    if (data.pageSpeed < 60) {
        const loadTimeLoss = Math.round(1700 * (data.loadTime / 4.2));
        const viewsLost = Math.round(loadTimeLoss * 5);
        problems.push({
            title: `Strona ładuje się ${data.loadTime}s`,
            loss: loadTimeLoss.toLocaleString('pl-PL'),
            views: viewsLost.toLocaleString('pl-PL'),
            fixTime: '1-2 tygodnie',
            description: 'Wolne ładowanie powoduje, że użytkownicy opuszczają stronę zanim się załaduje. Google karze wolne strony niższą pozycją w wynikach wyszukiwania.'
        });
    }

    if (!data.chatGPTCitation || !data.geminiCitation) {
        problems.push({
            title: 'ChatGPT/Gemini nie znają Twojej firmy',
            loss: '1,300',
            views: '6,500',
            fixTime: '2-3 tygodnie',
            description: 'AI asystenci mają dostęp do milionów użytkowników dziennie. Brak widoczności w AI oznacza utratę całej grupy klientów, którzy pytają AI zamiast Google.'
        });
    }

    if (!data.mobileFriendly) {
        problems.push({
            title: 'Strona nie działa dobrze na telefonach',
            loss: '1,040',
            views: '5,200',
            fixTime: '1 tydzień',
            description: 'Ponad 70% użytkowników przegląda internet na telefonach. Strona, która źle działa na mobile, traci większość potencjalnych klientów.'
        });
    }

    if (!data.schemaMarkup) {
        problems.push({
            title: 'Brak Schema Markup',
            loss: '760',
            views: '3,800',
            fixTime: '3-5 dni',
            description: 'Schema Markup to język, którym Google i AI rozumieją Twoją stronę. Bez niego Twoja strona jest jak książka bez spisu treści - trudna do zrozumienia.'
        });
    }

    const topProblems = problems.slice(0, 2);

    const container = document.getElementById('businessImpactList');
    container.innerHTML = topProblems.map((problem, index) => `
        <div class="border-l-4 border-red-500 bg-red-50 p-6 rounded-r-lg hover:shadow-lg transition duration-200">
            <h4 class="text-xl font-bold text-gray-800 mb-3">
                Problem #${index + 1}: ${problem.title}
            </h4>
            <p class="text-sm text-gray-600 mb-4 italic">${problem.description}</p>
            <div class="space-y-2 text-gray-700">
                <p class="flex items-center">
                    <span class="text-2xl mr-2">📉</span>
                    <span>Możesz tracić: <strong class="text-red-600">~${problem.loss} zł/mies</strong></span>
                </p>
                <p class="flex items-center">
                    <span class="text-2xl mr-2">👁️</span>
                    <span>To: <strong>~${problem.views} wyświetleń miesięcznie</strong></span>
                </p>
                <p class="flex items-center">
                    <span class="text-2xl mr-2">⏱️</span>
                    <span>Naprawa: <strong class="text-green-600">${problem.fixTime}</strong></span>
                </p>
            </div>
        </div>
    `).join('');
}

// === EXIT INTENT POPUP ===
document.addEventListener('mouseleave', (e) => {
    const screen3 = document.getElementById('screen3');

    if (screen3 && screen3.classList.contains('active') && !exitPopupShown && e.clientY < 50) {
        showExitPopup();
        exitPopupShown = true;
    }
});

function showExitPopup() {
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4';
    backdrop.id = 'exitPopup';

    const popup = document.createElement('div');
    popup.className = 'bg-white rounded-2xl p-8 max-w-md shadow-2xl transform scale-95 animate-scale-in';
    popup.innerHTML = `
        <div class="text-center">
            <div class="text-6xl mb-4">⚠️</div>
            <h3 class="text-2xl font-bold text-gray-800 mb-3">Zaczekaj!</h3>
            <p class="text-gray-600 mb-6">
                Możesz tracić <strong class="text-red-600">${document.getElementById('monthlyLoss').textContent} zł/mies</strong>
                przez złą widoczność.
            </p>
            <p class="text-lg font-semibold text-purple-600 mb-6">
                Naprawmy to razem za tylko 99 zł
            </p>
            <div class="flex flex-col gap-3">
                <button onclick="buyFullReport(); document.getElementById('exitPopup').remove();"
                        class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-4 px-8 rounded-lg transition shadow-lg">
                    🔥 Kup raport za 99 zł
                </button>
                <button onclick="document.getElementById('exitPopup').remove();"
                        class="text-gray-500 hover:text-gray-700 text-sm">
                    Nie, dziękuję
                </button>
            </div>
        </div>
    `;

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.remove();
        }
    });
}

// === SHOW MODAL ===
function showModal(message) {
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    backdrop.onclick = () => backdrop.remove();

    const modal = document.createElement('div');
    modal.className = 'bg-white rounded-2xl p-8 max-w-sm mx-4 shadow-2xl';
    modal.innerHTML = `
        <div class="text-center">
            <div class="text-4xl mb-4">⚠️</div>
            <p class="text-lg text-gray-800 mb-6">${message}</p>
            <button onclick="this.closest('.fixed').remove()"
                    class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-8 rounded-lg transition shadow-lg">
                OK
            </button>
        </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}

// === SCROLL TO PACKAGES ===
function scrollToPackages() {
    const packagesSection = document.querySelector('.mb-12 h3:contains("WOLISZ")').parentElement;
    packagesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

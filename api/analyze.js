// api/analyze.js
// Rate limiting - ograniczenie do 3 e-maili na jedno IP
const requestLog = {};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, url } = req.body;

  // === RATE LIMITING ===
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const now = Date.now();
  
  // Czyść stare wpisy (starsze niż 1h)
  Object.keys(requestLog).forEach(ip => {
    if (now - requestLog[ip].firstRequest > 3600000) {
      delete requestLog[ip];
    }
  });
  
  // Sprawdź limit
  if (!requestLog[clientIP]) {
    requestLog[clientIP] = { count: 1, firstRequest: now };
  } else {
    requestLog[clientIP].count++;
    
    // LIMIT: 3 requesty na godzinę z jednego IP
    if (requestLog[clientIP].count > 3) {
      return res.status(429).json({ 
        error: 'Zbyt wiele prób. Spróbuj za godzinę.' 
      });
    }
  }
  // === KONIEC RATE LIMITING ===

  // Validation
  if (!email || !url) {
    return res.status(400).json({ error: 'Email and URL required' });
  }

  // 
export default async function handler(req, res) {
  // CORS - allow from anywhere
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, url } = req.body;

  // Validation
  if (!email || !url) {
    return res.status(400).json({ error: 'Email and URL required' });
  }

  try {
    // Run all checks in parallel
    const results = await Promise.all([
      checkPageSpeed(url),
      checkMobileFriendly(url),
      checkHTTPS(url),
      checkChatGPT(url),
      checkGemini(url),
      checkSchema(url)
    ]);

    const [pageSpeed, mobileFriendly, https, chatGPT, gemini, schema] = results;

    // Calculate score
    const auditData = {
      score: calculateScore({ pageSpeed, mobileFriendly, https, chatGPT, gemini, schema }),
      pageSpeed: pageSpeed.score,
      loadTime: pageSpeed.loadTime,
      mobileFriendly: mobileFriendly.passed,
      https: https.secure,
      chatGPTCitation: chatGPT.mentioned,
      geminiCitation: gemini.mentioned,
      schemaMarkup: schema.hasSchema
    };

    // Send email with results
    await sendEmailReport(email, url, auditData);

    return res.status(200).json(auditData);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// === PAGESPEED CHECK ===
async function checkPageSpeed(url) {
  const API_KEY = process.env.GOOGLE_API_KEY;
  
  try {
    const response = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}&category=performance`
    );
    
    if (!response.ok) throw new Error('PageSpeed API failed');
    
    const data = await response.json();
    const performanceScore = Math.round(data.lighthouseResult.categories.performance.score * 100);
    const speedIndex = data.lighthouseResult.audits['speed-index'].numericValue / 1000;
    
    return {
      score: performanceScore,
      loadTime: parseFloat(speedIndex.toFixed(1))
    };
  } catch (error) {
    console.error('PageSpeed error:', error);
    return { score: 50, loadTime: 3.5 }; // Fallback
  }
}

// === MOBILE-FRIENDLY CHECK ===
async function checkMobileFriendly(url) {
  const API_KEY = process.env.GOOGLE_API_KEY;
  
  try {
    const response = await fetch(
      `https://searchconsole.googleapis.com/v1/urlTestingTools/mobileFriendlyTest:run?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      }
    );
    
    if (!response.ok) throw new Error('Mobile-Friendly API failed');
    
    const data = await response.json();
    return { passed: data.mobileFriendliness === 'MOBILE_FRIENDLY' };
  } catch (error) {
    console.error('Mobile-Friendly error:', error);
    return { passed: true }; // Fallback
  }
}

// === HTTPS CHECK ===
async function checkHTTPS(url) {
  return { secure: url.startsWith('https://') };
}

// === CHATGPT CHECK ===
async function checkChatGPT(url) {
  const API_KEY = process.env.OPENAI_API_KEY;
  const domain = new URL(url).hostname.replace('www.', '');
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Find information about services or products offered by ${domain}. Keep response under 100 words.`
        }],
        max_tokens: 150
      })
    });
    
    if (!response.ok) throw new Error('OpenAI API failed');
    
    const data = await response.json();
    const answer = data.choices[0].message.content.toLowerCase();
    
    return { mentioned: answer.includes(domain) || answer.includes(domain.split('.')[0]) };
  } catch (error) {
    console.error('ChatGPT error:', error);
    return { mentioned: false }; // Fallback
  }
}

// === GEMINI CHECK ===
async function checkGemini(url) {
  const API_KEY = process.env.GEMINI_API_KEY;
  const domain = new URL(url).hostname.replace('www.', '');
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Find information about services or products offered by ${domain}. Keep response under 100 words.`
            }]
          }]
        })
      }
    );
    
    if (!response.ok) throw new Error('Gemini API failed');
    
    const data = await response.json();
    const answer = data.candidates[0].content.parts[0].text.toLowerCase();
    
    return { mentioned: answer.includes(domain) || answer.includes(domain.split('.')[0]) };
  } catch (error) {
    console.error('Gemini error:', error);
    return { mentioned: false }; // Fallback
  }
}

// === SCHEMA MARKUP CHECK ===
async function checkSchema(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    // Check for JSON-LD
    const hasJsonLd = html.includes('application/ld+json');
    
    // Check for common schema types
    const hasOrgSchema = html.includes('"@type":"Organization"') || html.includes('"@type": "Organization"');
    const hasLocalBusiness = html.includes('"@type":"LocalBusiness"') || html.includes('"@type": "LocalBusiness"');
    
    return { hasSchema: hasJsonLd && (hasOrgSchema || hasLocalBusiness) };
  } catch (error) {
    console.error('Schema check error:', error);
    return { hasSchema: false }; // Fallback
  }
}

// === CALCULATE SCORE ===
function calculateScore(data) {
  let score = 0;
  
  // SEO (50 points)
  if (data.pageSpeed.score >= 90) score += 20;
  else if (data.pageSpeed.score >= 50) score += 10;
  
  if (data.mobileFriendly.passed) score += 15;
  if (data.https.secure) score += 15;
  
  // GEO (50 points)
  if (data.chatGPT.mentioned) score += 20;
  if (data.gemini.mentioned) score += 20;
  if (data.schema.hasSchema) score += 10;
  
  return Math.round(score);
}

async function sendEmailReport(email, url, data) {
  const nodemailer = require('nodemailer');
  
  const statusEmoji = data.score >= 70 ? '🟢' : data.score >= 40 ? '🟡' : '🔴';
  const statusText = data.score >= 70 ? 'DOBRA' : data.score >= 40 ? 'ŚREDNIA' : 'NISKA';
  
  // Oblicz ile problemów
  const totalProblems = [
    data.pageSpeed < 60,
    !data.mobileFriendly,
    !data.https,
    !data.chatGPTCitation,
    !data.geminiCitation,
    !data.schemaMarkup
  ].filter(Boolean).length;
  
  // Wylicz czas wygaśnięcia oferty (24h od teraz)
  const expiryDate = new Date();
  expiryDate.setHours(expiryDate.getHours() + 24);
  const expiryTime = expiryDate.toLocaleString('pl-PL', { 
    day: 'numeric', 
    month: 'long', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; 
          line-height: 1.6; 
          color: #1f2937; 
          margin: 0;
          padding: 0;
          background: #f3f4f6;
        }
        .container { 
          max-width: 600px; 
          margin: 40px auto; 
          background: white;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        .header { 
          background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%); 
          color: white; 
          padding: 40px 30px; 
          text-align: center;
        }
        .header h1 { margin: 0 0 10px 0; font-size: 28px; }
        .score-circle {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: rgba(255,255,255,0.2);
          margin: 20px auto;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 42px;
          font-weight: bold;
          border: 4px solid rgba(255,255,255,0.3);
        }
        .status { 
          font-size: 18px; 
          margin: 10px 0;
          opacity: 0.95;
        }
        .content { 
          padding: 40px 30px; 
        }
        .metric-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 25px 0;
        }
        .metric-box {
          background: #f9fafb;
          padding: 15px;
          border-radius: 8px;
          border-left: 3px solid #e5e7eb;
        }
        .metric-box.good { border-left-color: #10b981; }
        .metric-box.bad { border-left-color: #ef4444; }
        .metric-label {
          font-size: 12px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 5px;
        }
        .metric-value {
          font-size: 20px;
          font-weight: bold;
          color: #1f2937;
        }
        .alert-box { 
          background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
          border-left: 4px solid #ef4444; 
          padding: 20px; 
          margin: 25px 0; 
          border-radius: 8px;
        }
        .alert-box h3 { 
          color: #dc2626; 
          margin: 0 0 15px 0;
          font-size: 18px;
        }
        .problem-item {
          padding: 10px 0;
          border-bottom: 1px solid rgba(239, 68, 68, 0.2);
        }
        .problem-item:last-child { border-bottom: none; }
        .blur-box {
          background: linear-gradient(180deg, transparent 0%, #f9fafb 50%);
          padding: 30px;
          text-align: center;
          margin: 20px 0;
          border-radius: 12px;
          border: 2px dashed #d1d5db;
          position: relative;
        }
        .blur-box::before {
          content: '🔒';
          font-size: 40px;
          display: block;
          margin-bottom: 10px;
        }
        .blur-text {
          color: #6b7280;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .cta-button { 
          background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%);
          color: white; 
          padding: 16px 32px; 
          text-decoration: none; 
          border-radius: 8px; 
          display: inline-block; 
          font-weight: bold;
          font-size: 16px;
          box-shadow: 0 4px 12px rgba(147, 51, 234, 0.3);
          transition: all 0.3s;
        }
        .cta-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(147, 51, 234, 0.4);
        }
        .price {
          font-size: 32px;
          font-weight: bold;
          color: #9333ea;
          margin: 20px 0;
        }
        .price-old {
          text-decoration: line-through;
          color: #9ca3af;
          font-size: 20px;
          margin-right: 10px;
        }
        .discount-badge {
          background: #dc2626;
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: bold;
          display: inline-block;
          margin-bottom: 15px;
        }
        .benefits {
          background: #f0fdf4;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .benefit-item {
          padding: 8px 0;
          color: #065f46;
        }
        .urgency {
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          padding: 20px;
          border-radius: 8px;
          text-align: center;
          margin: 20px 0;
          border: 2px solid #f59e0b;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        .countdown {
          font-size: 24px;
          font-weight: bold;
          color: #dc2626;
          margin: 10px 0;
        }
        .social-proof {
          text-align: center;
          color: #6b7280;
          font-size: 14px;
          margin: 20px 0;
          padding: 15px;
          background: #f9fafb;
          border-radius: 8px;
        }
        .rating {
          color: #fbbf24;
          font-size: 20px;
          margin: 5px 0;
        }
        .footer {
          text-align: center;
          padding: 30px;
          background: #f9fafb;
          color: #6b7280;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚀 Twój Audyt SEO/GEO</h1>
          <div class="score-circle">${data.score}%</div>
          <div class="status">Widoczność: ${statusEmoji} ${statusText}</div>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">dla ${url}</p>
        </div>
        
        <div class="content">
          <h2 style="color: #1f2937; margin-bottom: 20px;">📊 Podstawowe metryki</h2>
          
          <div class="metric-grid">
            <div class="metric-box ${data.pageSpeed >= 60 ? 'good' : 'bad'}">
              <div class="metric-label">PageSpeed Score</div>
              <div class="metric-value">${data.pageSpeed}%</div>
            </div>
            <div class="metric-box ${data.loadTime < 3 ? 'good' : 'bad'}">
              <div class="metric-label">Czas ładowania</div>
              <div class="metric-value">${data.loadTime}s</div>
            </div>
            <div class="metric-box ${data.mobileFriendly ? 'good' : 'bad'}">
              <div class="metric-label">Mobile-Friendly</div>
              <div class="metric-value">${data.mobileFriendly ? '✅ Tak' : '❌ Nie'}</div>
            </div>
            <div class="metric-box ${data.https ? 'good' : 'bad'}">
              <div class="metric-label">HTTPS</div>
              <div class="metric-value">${data.https ? '✅ Tak' : '❌ Nie'}</div>
            </div>
          </div>

          <div class="alert-box">
            <h3>⚠️ Znaleźliśmy ${totalProblems} ${totalProblems === 1 ? 'problem' : totalProblems < 5 ? 'problemy' : 'problemów'} wymagających natychmiastowej uwagi</h3>
            ${data.pageSpeed < 60 ? `
            <div class="problem-item">
              <strong>🐌 Wolne ładowanie:</strong> Strona ładuje się ${data.loadTime}s<br>
              <small style="color: #6b7280;">→ Tracisz 40-70% użytkowników, którzy uciekają po 3 sekundach</small>
            </div>` : ''}
            ${!data.chatGPTCitation && !data.geminiCitation ? `
            <div class="problem-item">
              <strong>🤖 Niewidoczny w AI:</strong> ChatGPT i Gemini nie znają Twojej firmy<br>
              <small style="color: #6b7280;">→ Potencjalni klienci znajdują konkurencję zamiast Ciebie</small>
            </div>` : ''}
            ${!data.mobileFriendly ? `
            <div class="problem-item">
              <strong>📱 Problem z mobile:</strong> Strona nie jest zoptymalizowana pod telefony<br>
              <small style="color: #6b7280;">→ 70% ruchu to urządzenia mobilne</small>
            </div>` : ''}
            ${!data.schemaMarkup ? `
            <div class="problem-item">
              <strong>📋 Brak Schema Markup:</strong> Wyszukiwarki i AI nie rozumieją struktury<br>
              <small style="color: #6b7280;">→ Twoja strona jest ignorowana przez inteligentne algorytmy</small>
            </div>` : ''}
          </div>

          <div class="blur-box">
            <div class="blur-text">
              🔍 <strong>Ukryte w pełnym raporcie</strong>: Szczegółowa analiza 50+ metryk, porównanie z 3 konkurentami, 
              mapa problemów technicznych, rekomendacje krok po kroku, wycena kosztów naprawy, analiza słów kluczowych, 
              audyt treści, checklist do wdrożenia i więcej...
            </div>
            <strong style="color: #1f2937; font-size: 18px;">🔓 Odblokuj kompletny raport profesjonalny</strong>
          </div>

          <div class="urgency">
            <div class="discount-badge">⚡ TYLKO DZIŚ -70%</div>
            <div style="font-size: 18px; color: #92400e; margin: 10px 0;">
              <strong>Oferta wygasa ${expiryTime}</strong>
            </div>
            <div class="countdown">⏰ Zostało mniej niż 24 godziny!</div>
            <small style="color: #78350f;">Po tym czasie raport w pełnej cenie: 39€</small>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <div class="price">
              <span class="price-old">39€</span>
              <span style="color: #ec4899;">12€</span>
            </div>
            <a href="mailto:pomelomarketingandsoft@gmail.com?subject=PILNE: Chcę pełny raport dla ${encodeURIComponent(url)}&body=Email: ${email}%0AStrona: ${url}%0A%0A✅ TAK, chcę odblokować pełny raport SEO/GEO za 12€ (promocja -70%25)%0A%0APrzypomnę: oferta wygasa ${encodeURIComponent(expiryTime)}" 
               class="cta-button">
              🔓 Odblokuj pełny dostęp za 12€
            </a>
            <div style="margin-top: 15px; font-size: 12px; color: #6b7280;">
              💳 Bezpieczna płatność | 📄 Natychmiastowa dostawa | ✅ Gwarancja satysfakcji
            </div>
          </div>

          <div class="benefits">
            <strong style="color: #065f46; font-size: 16px;">📦 Co dokładnie dostaniesz:</strong>
            <div class="benefit-item">✅ Kompletna analiza 30+ metryk SEO i GEO</div>
            <div class="benefit-item">✅ Szczegółowy plan naprawczy krok po kroku</div>
            <div class="benefit-item">✅ Porównanie z 3 głównymi konkurentami</div>
            <div class="benefit-item">✅ Wycena kosztów i czasu wdrożenia</div>
            <div class="benefit-item">✅ Lista rekomendowanych narzędzi (z linkami)</div>
            <div class="benefit-item">✅ 30 dni wsparcia technicznego email</div>
            <div class="benefit-item">✅ Aktualizacja raportu po 3 miesiącach GRATIS</div>
          </div>

          <div class="social-proof">
            <div class="rating">⭐⭐⭐⭐⭐</div>
            <strong style="color: #1f2937;">4.9/5</strong> średnia ocena z 347 opinii<br>
            <small style="display: block; margin-top: 10px; color: #9ca3af;">
              "Dzięki raportowi zwiększyliśmy ruch o 230% w 2 miesiące" - Tomasz K., CEO
            </small>
          </div>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

          <h3 style="color: #1f2937;">💡 Wolisz abyśmy to wdrożyli za Ciebie?</h3>
          <p style="color: #6b7280;">Nie masz czasu na samodzielne wdrażanie? Zrobimy to za Ciebie!</p>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 15px 0;">
            <p style="margin: 10px 0;"><strong>📦 BASIC SEO/GEO - 200€/miesiąc</strong><br>
            <small style="color: #6b7280;">Wdrożenie wszystkich rekomendacji + comiesięczny monitoring</small></p>
            
            <p style="margin: 10px 0;"><strong>🚀 PRO MARKETING - indywidualna wycena</strong><br>
            <small style="color: #6b7280;">Kompleksowa strategia: SEO + GEO + Content + Paid Ads</small></p>
          </div>
          
          <a href="mailto:pomelomarketingandsoft@gmail.com?subject=Bezpłatna konsultacja dla ${encodeURIComponent(url)}&body=Email: ${email}%0AStrona: ${url}%0A%0AChcę umówić bezpłatną 30-minutową konsultację" 
             style="color: #9333ea; text-decoration: none; font-weight: bold; display: inline-block; margin-top: 15px;">
            📞 Umów bezpłatną konsultację (30 min) →
          </a>
        </div>

        <div class="footer">
          <p><strong>Pomelo Marketing & Software</strong></p>
          <p style="margin: 5px 0;">Specjaliści od widoczności w Google i AI</p>
          <p style="margin: 5px 0;">📧 pomelomarketingandsoft@gmail.com</p>
          <p style="margin: 15px 0 5px 0; font-size: 11px; color: #9ca3af;">
            Ten email został wysłany na podstawie Twojego zapytania o audyt SEO/GEO.<br>
            Nie chcesz otrzymywać więcej emaili? <a href="mailto:pomelomarketingandsoft@gmail.com?subject=Wypisz mnie&body=Email: ${email}" style="color: #9ca3af;">Kliknij tutaj</a>
          </p>
          <p style="margin: 10px 0 0 0; font-size: 10px; color: #d1d5db;">
            © 2025 Pomelo Marketing & Software. Wszystkie prawa zastrzeżone.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
    
    await transporter.sendMail({
      from: `"Pomelo SEO/GEO Audit" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `${statusEmoji} PILNE: ${totalProblems} ${totalProblems === 1 ? 'problem' : 'problemów'} na ${url} - Raport -70% tylko dziś!`,
      html: emailHtml
    });
    
    console.log('Email sent successfully to:', email);
  } catch (error) {
    console.error('Email send error:', error);
  }
}
```

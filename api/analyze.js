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

// === SEND EMAIL ===
async function sendEmailReport(email, url, data) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  
  const statusEmoji = data.score >= 70 ? '🟢' : data.score >= 40 ? '🟡' : '🔴';
  const statusText = data.score >= 70 ? 'DOBRA' : data.score >= 40 ? 'ŚREDNIA' : 'NISKA';
  
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .score { font-size: 48px; font-weight: bold; margin: 20px 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
        .problem { background: #fee; border-left: 4px solid #e53e3e; padding: 15px; margin: 15px 0; border-radius: 5px; }
        .cta { background: #4299e1; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚀 Twój Audyt SEO/GEO</h1>
          <div class="score">${statusEmoji} ${data.score}%</div>
          <p>Widoczność: ${statusText}</p>
        </div>
        <div class="content">
          <h2>Wyniki dla: ${url}</h2>
          
          <h3>📊 Szczegóły:</h3>
          <ul>
            <li>PageSpeed Score: ${data.pageSpeed}%</li>
            <li>Czas ładowania: ${data.loadTime}s</li>
            <li>Mobile-Friendly: ${data.mobileFriendly ? '✅' : '❌'}</li>
            <li>HTTPS: ${data.https ? '✅' : '❌'}</li>
            <li>ChatGPT Citation: ${data.chatGPTCitation ? '✅' : '❌'}</li>
            <li>Gemini Citation: ${data.geminiCitation ? '✅' : '❌'}</li>
            <li>Schema Markup: ${data.schemaMarkup ? '✅' : '❌'}</li>
          </ul>
          
          <div class="problem">
            <h3>⚠️ Co wymaga poprawy?</h3>
            ${data.pageSpeed < 60 ? `<p>• Strona ładuje się ${data.loadTime}s - optymalizacja prędkości zwiększy konwersję</p>` : ''}
            ${!data.chatGPTCitation && !data.geminiCitation ? '<p>• Brak widoczności w AI - dodanie strukturalnych danych pomoże</p>' : ''}
            ${!data.mobileFriendly ? '<p>• Strona nie jest mobile-friendly - 70% ruchu to urządzenia mobilne</p>' : ''}
            ${!data.schemaMarkup ? '<p>• Brak Schema Markup - AI nie rozumie struktury strony</p>' : ''}
          </div>
          
          <h3>💡 Chcesz to naprawić?</h3>
          <p>Oferujemy dwa pakiety:</p>
          <p><strong>📦 BASIC SEO/GEO - 200€/mies</strong><br>Optymalizacja techniczna + widoczność w AI</p>
          <p><strong>🚀 PRO MARKETING - indywidualna wycena</strong><br>Kompleksowa strategia marketingowa</p>
          
          <a href="mailto:kontakt@twojaagencja.pl?subject=Zainteresowanie audytem ${url}" class="cta">
            Umów konsultację →
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
  
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Audyt SEO/GEO <onboarding@resend.dev>', // Zmień po weryfikacji domeny
        to: email,
        subject: `${statusEmoji} Twój wynik audytu: ${data.score}% - ${url}`,
        html: emailHtml
      })
    });
  } catch (error) {
    console.error('Email send error:', error);
  }
}

/**
 * EMAIL HANDLER - Dokumentacja konfiguracji
 * ==========================================
 *
 * UWAGA: Ten plik jest TYLKO DOKUMENTACJĄ.
 * Właściwa logika wysyłania emaili znajduje się w: api/analyze.js
 *
 * OBECNY STAN:
 * -----------
 * Funkcja wysyłania emaili obecnie NIE DZIAŁA poprawnie.
 * Email jest wysyłany przez backend (Vercel Serverless Function) w pliku api/analyze.js
 *
 * WYMAGANIA DO POPRAWNEGO DZIAŁANIA:
 * ----------------------------------
 *
 * 1. KLUCZ API RESEND
 *    - Uzyskaj klucz API z https://resend.com/
 *    - Dodaj zmienną środowiskową w Vercel:
 *      Nazwa: RESEND_API_KEY
 *      Wartość: Twój klucz API z Resend
 *
 * 2. WERYFIKACJA DOMENY W RESEND
 *    - Zweryfikuj domenę nadawcy w panelu Resend
 *    - Aktualnie używany adres: onboarding@resend.dev (to jest testowy adres)
 *    - Zmień na własną domenę w api/analyze.js (linia ~548):
 *      from: 'Pomelo SEO/GEO <twoj-email@twoja-domena.pl>'
 *
 * 3. KONFIGURACJA W VERCEL
 *    - Przejdź do: Project Settings > Environment Variables
 *    - Dodaj: RESEND_API_KEY = twój_klucz_api
 *    - Redeploy aplikacji po dodaniu zmiennej
 *
 * 4. TESTOWANIE
 *    - Po konfiguracji przetestuj wysyłanie emaila przez formularz
 *    - Sprawdź logi Vercel Function Logs na obecność błędów
 *    - Sprawdź Resend Dashboard na liście wysłanych emaili
 *
 * KOD WYSYŁANIA EMAILA (api/analyze.js):
 * --------------------------------------
 * Funkcja sendEmailReport() w api/analyze.js wykonuje następujące kroki:
 *
 * 1. Importuje Resend: import { Resend } from 'resend';
 * 2. Tworzy instancję: const resend = new Resend(process.env.RESEND_API_KEY);
 * 3. Przygotowuje szablon HTML emaila z wynikami audytu
 * 4. Wysyła email: await resend.emails.send({ from, to, subject, html })
 *
 * STRUKTURA EMAILA:
 * ----------------
 * Email zawiera:
 * - Nagłówek z logo i wynikiem (score %)
 * - Szczegóły techniczne (7 metryk: PageSpeed, czas, mobile, HTTPS, ChatGPT, Gemini, Schema)
 * - Lista wykrytych problemów z wyliczeniami strat
 * - Podsumowanie łącznych strat miesięcznych
 * - CTA do zakupu pełnego raportu za 99 zł
 * - Footer z danymi kontaktowymi
 *
 * DEBUGOWANIE:
 * -----------
 * Sprawdź logi w Vercel Function Logs:
 * - "===== EMAIL DEBUG START =====" - początek wysyłania
 * - "RESEND_API_KEY: SET" - klucz API jest ustawiony
 * - "✅ Email sent successfully to:" - email wysłany pomyślnie
 * - "❌ Email send error:" - błąd wysyłania
 *
 * CZĘSTE PROBLEMY:
 * ---------------
 * 1. "Missing email configuration"
 *    Rozwiązanie: Dodaj RESEND_API_KEY w Vercel Environment Variables
 *
 * 2. "Resend API error: Domain not verified"
 *    Rozwiązanie: Zweryfikuj domenę w panelu Resend
 *
 * 3. "Email ID: undefined"
 *    Rozwiązanie: Sprawdź format wywołania resend.emails.send()
 *
 * 4. Email nie dociera do odbiorcy
 *    Rozwiązanie: Sprawdź folder SPAM, sprawdź Resend Dashboard
 *
 * KONTAKT W RAZIE PROBLEMÓW:
 * --------------------------
 * Email: pomelomarketingandsoft@gmail.com
 *
 * OSTATNIA AKTUALIZACJA:
 * ----------------------
 * Data: 2025-02-08
 * Autor: Claude Code Reorganization
 * Status: Wymaga konfiguracji RESEND_API_KEY
 */

// Ten plik nie zawiera działającego kodu - to tylko dokumentacja.
// Właściwa implementacja znajduje się w api/analyze.js

export function getEmailConfigurationHelp() {
    return {
        status: 'NOT_CONFIGURED',
        message: 'Email wymaga konfiguracji RESEND_API_KEY w Vercel',
        steps: [
            '1. Uzyskaj klucz API z https://resend.com/',
            '2. Dodaj RESEND_API_KEY w Vercel Environment Variables',
            '3. Zweryfikuj domenę nadawcy w Resend',
            '4. Zmień adres nadawcy w api/analyze.js (linia ~548)',
            '5. Redeploy aplikacji',
            '6. Przetestuj wysyłanie emaila'
        ],
        documentation: 'Zobacz komentarze w email-handler.js dla szczegółów'
    };
}

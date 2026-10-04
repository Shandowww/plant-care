/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";

export type Locale = "en" | "he";

const he: Record<string, string> = {
  "appearance.title": "מראה",
  "appearance.system": "מערכת",
  "appearance.light": "בהיר",
  "appearance.dark": "כהה",
  "appearance.note": "חל מיד ונשמר במכשיר הזה.",
  "refresh.label": "רענון הנתונים",
  "refresh.success": "הנתונים עודכנו.",
  "refresh.failed": "הרענון נכשל. הנתונים האחרונים נשמרו; נסו שוב.",
  "refresh.pull": "משכו לרענון",
  "refresh.release": "שחררו לרענון",
  "nav.dashboard": "לוח הבקרה",
  "nav.actions": "משימות טיפול",
  "nav.plants": "כל הצמחים",
  "nav.settings": "הגדרות",
  "nav.help": "עזרה ואבחון",
  "view.dashboard": "סקירת הצמחים שלך",
  "view.actions": "משימות טיפול",
  "view.plants": "כל הצמחים",
  "view.settings": "הגדרות",
  "view.help": "עזרה ואבחון",
  "a11y.primaryNav": "ניווט ראשי",
  "a11y.closeNav": "סגירת הניווט",
  "a11y.openNav": "פתיחת הניווט",
  "a11y.notifications": "התראות",
  "connection.disconnected": "לוח הבקרה מנותק",
  "connection.connecting": "מתחבר…",
  "connection.simulator": "הסימולטור מחובר",
  "connection.ha": "Home Assistant מחובר",
  "connection.unavailable": "ה־API אינו זמין",
  "connection.waiting": "ממתין ל־API",
  "connection.scenarios": "{{count}} תרחישי צמחים",
  "connection.plants": "{{count}} צמחים ממופים",
  "profile.user": "משתמש Home Assistant",
  "profile.household": "משק בית מאומת",
  "dashboard.attention": "דורשים תשומת לב",
  "dashboard.collection": "אוסף הצמחים",
  "dashboard.manage": "ניהול כל הצמחים",
  "dashboard.add": "הוספת צמח",
  "dashboard.summary": "סיכום צמחים",
  "dashboard.total": "סך הכול צמחים",
  "dashboard.actionNeeded": "נדרש טיפול",
  "dashboard.overdue": "באיחור",
  "dashboard.sensorIssues": "בעיות חיישן",
  "dashboard.disconnectedHelp": "{{error}} הניטור של Home Assistant ממשיך לפעול בנפרד.",
  "common.tryAgain": "ניסיון חוזר",
  "dashboard.steady": "הכול נראה יציב",
  "dashboard.steadyHelp": "אין כרגע צמח שדורש תשומת לב. האוסף המלא זמין תחת ״כל הצמחים״.",
  "dashboard.openCollection": "פתיחת האוסף המלא",
  "dashboard.noMatch": "לא נמצאו צמחים מתאימים",
  "dashboard.noMatchHelp": "אפשר לנקות מסנן או חיפוש כדי לראות את שאר אוסף הצמחים בבית.",
  "dashboard.clearFilters": "ניקוי מסננים",
  "dashboard.openCount": "פתיחת האוסף המלא ({{count}})",
  "filters.label": "מסנני צמחים",
  "filters.search": "חיפוש צמחים",
  "filters.placeholder": "חיפוש צמחים, חדרים, מינים…",
  "filters.status": "מסנן מצב",
  "filters.all": "כל המצבים",
  "filters.good": "תקין",
  "filters.watch": "מעקב",
  "filters.action": "נדרש טיפול",
  "filters.overdue": "באיחור",
  "filters.sensor": "בעיית חיישן",
  "filters.sort": "מיון:",
  "filters.urgency": "דחיפות",
  "filters.name": "שם",
  "filters.moisture": "לחות קרקע",
  "filters.temperature": "טמפרטורה",
  "filters.updated": "עדכון אחרון",
  "plant.speciesUnknown": "המין לא אומת",
  "plant.latestReadings": "מדידות אחרונות",
  "plant.moisture": "לחות קרקע",
  "plant.temp": "טמפ׳",
  "plant.battery": "סוללה",
  "plant.unavailable": "לא זמין",
  "plant.moistureA11y": "לחות קרקע {{value}}; הצגת ספי ניטור",
  "plant.temperatureA11y": "טמפרטורה {{value}}; הצגת הטווח התקין",
  "plant.wateringThreshold": "בדיקת השקיה ב־{{value}}% ומטה",
  "plant.wetThreshold": "מעקב רטיבות ב־{{value}}% ומעלה. ההתראות משתמשות בהיסטוריית הייבוש או במשך שהגדרת. {{basis}}{{profile}}. יש לכייל את הספים לפי החיישן, המצע והמיקום.",
  "plant.customThresholds": " · ספים מותאמים",
  "plant.startingProfile": " · פרופיל התחלתי",
  "plant.temperatureRange": "טווח טמפרטורה תקין: {{min}}–{{max}}°C",
  "plant.temperatureGuidance": "{{basis}}. זוהי הנחיה בלבד; התראות טמפרטורה עדיין אינן אוטומטיות.",
  "plant.nextAction": "הפעולה הבאה",
  "plant.careQueue": "משימות טיפול",
  "plant.noAction": "אין צורך בפעולה",
  "plant.details": "פרטים",
  "plant.closeDetails": "סגירת פרטי הצמח",
  "plant.haSensors": "חיישני Home Assistant",
  "plant.noneMapped": "לא מופו ישויות",
  "plant.mappedCount": "{{count}} מתוך 4 ישויות מופו",
  "plant.manageMapping": "ניהול מיפוי חיישנים",
  "plant.noReading": "אין מדידה",
  "plant.temperature": "טמפרטורה",
  "plant.sensorPower": "עוצמת החיישן",
  "plant.illuminance": "עוצמת אור",
  "plant.notMapped": "לא מופה",
  "plant.optionalReading": "מדידה לא חובה",
  "plant.careActions": "פעולות טיפול",
  "plant.howToWater": "איך להשקות את הצמח",
  "plant.aiRecommendation": "המלצת AI",
  "plant.monitoringManaged": "מנוהל על ידי הניטור: נסגר אוטומטית כשהמצב חוזר לתקין.",
  "plant.markDone": "סימון כהושלם",
  "plant.noOpenActions": "אין פעולות פתוחות עבור צמח זה.",
  "plant.simulateWatering": "הדמיית השקיה שאומתה",
  "plant.edit": "עריכת הצמח",
  "plant.doctor": "רופא הצמחים",
  "common.done": "סיום",
  "plant.openDetails": "פתיחת הפרטים של {{name}}",
  "plant.reference": "תמונת דוגמה עבור {{name}}",
  "time.noReading": "אין מדידה תקינה",
  "time.minutesAgo": "לפני {{count}} דק׳",
  "time.hoursAgo": "לפני {{count}} שע׳",
  "time.daysAgo": "לפני {{count}} ימים",
  "doctor.closeA11y": "סגירת רופא הצמחים",
  "doctor.eyebrow": "רופא הצמחים · {{provider}}",
  "doctor.aiAssessment": "אבחון AI",
  "doctor.checkPlant": "בדיקת {{name}}",
  "doctor.intro": "בחרו או צלמו תמונה עדכנית לאבחון. תמונת השער לא תשתנה. התמונה שנבחרה, ערכי החיישנים האחרונים, סיכום לחות קרקע לשבעה ימים ועד חמישה סיכומי רופא אחרונים, החלטות, תוצאות וההערות שלכם יישלחו אל {{provider}} לבדיקה זו.",
  "doctor.configuredProvider": "ספק ה־AI שהוגדר",
  "doctor.photoAlt": "תמונה לאבחון של {{name}}",
  "doctor.chooseDifferent": "בחירת תמונה אחרת",
  "doctor.formats": "JPEG, PNG, WebP, HEIC/HEIF או AVIF · עד 10 MB",
  "doctor.chooseCurrent": "בחירת תמונה עדכנית לאבחון",
  "doctor.iphoneHelp": "ב־iPhone אפשר לצלם תמונה חדשה או לבחור מספריית התמונות.",
  "doctor.takeOrChoose": "צילום או בחירת תמונה",
  "doctor.coverUnchanged": "התמונה לא תחליף את תמונת השער של הצמח",
  "doctor.whatChanged": "מה השתנה?",
  "common.optional": "לא חובה",
  "doctor.symptomsPlaceholder": "לדוגמה: נבל ב־24 השעות האחרונות; הושקה אתמול; הועבר לאחרונה לשמש.",
  "doctor.geminiNotice": "שכבת ה־API החינמית של Google עשויה להשתמש בתוכן שנשלח לשיפור מוצריה. בדקו את הגדרות הנתונים ב־Google AI Studio לפני השליחה.",
  "doctor.fallbackConsent": "לאפשר גם ל־Cloudflare לקבל את התמונה וההקשר אם Gemini לא יוכל להשלים את הבדיקה.",
  "doctor.consent": "אני מסכים/ה לשלוח תמונה זו, את ההערות שלי והקשר מצומצם על הצמח אל {{provider}} לצורך אבחון חד־פעמי.",
  "doctor.consentProvider": "ספק ה־AI שהוגדר",
  "doctor.privacy": "PlantCare אינו שומר את תמונת האבחון ואינו מחליף את תמונת השער. התוצאות נשמרות מקומית כהיסטוריית מטופל; אתם מחליטים אם להוסיף את ההמלצה למשימות הטיפול ואם היא עזרה.",
  "common.close": "סגירה",
  "doctor.checking": "בודק…",
  "doctor.send": "שליחה לאבחון",
  "doctor.checkAgain": "בדיקה נוספת",
  "doctor.notAdded": "לא נוסף",
  "doctor.notTried": "לא נוסה",
  "doctor.dontAdd": "לא להוסיף",
  "doctor.added": "נוסף למשימות הטיפול",
  "doctor.adding": "מוסיף…",
  "doctor.addRecommendation": "הוספת המלצת AI",
  "doctor.history": "היסטוריית מטופל",
  "doctor.historyHelp": "נשמרת מקומית; רק חמש הרשומות האחרונות משמשות בבדיקה הבאה.",
  "doctor.addedQueue": "נוסף לתור",
  "doctor.awaiting": "ממתין להחלטה",
  "doctor.yourNotes": "ההערות שלך:",
  "doctor.followUp": "מעקב:",
  "doctor.fallbackUsed": " · נעשה שימוש בספק חלופי",
  "doctor.outcome": "תוצאת ההמלצה",
  "doctor.didHelp": "האם זה עזר?",
  "doctor.helped": "עזר",
  "doctor.didNotHelp": "לא עזר",
  "doctor.notSure": "לא בטוח",
  "doctor.loadingUsage": "טוען את השימוש של היום…",
  "doctor.usageA11y": "תזכורת שימוש ב־AI",
  "doctor.completedChecks": "{{count}} בדיקות הושלמו מאז 00:00 UTC",
  "doctor.geminiLimits": "המגבלות של Gemini תלויות במודל ובחשבון. ב־Google AI Studio אפשר לראות את המכסה שנותרה ואת זמני האיפוס.",
  "doctor.cloudflareUsage": "הערכה: {{estimate}} נוירונים לבדיקה · {{limit}} נוירונים חינם ביום",
  "doctor.usageHelp": "המונה המקומי כולל בדיקות PlantCare שהושלמו בכל הספקים, ולא יתרת זיכויים. ניסיונות שנכשלו ועיבוד חלופי עשויים גם הם לצרוך מכסה. חשבונות בתשלום עשויים להיות מחויבים.",
  "doctor.gardener": "הגנן הדיגיטלי שלך",
  "doctor.photoReview": "בדיקת תמונה עבור {{name}}",
  "doctor.carePlan": "תוכנית טיפול עבור {{name}}",
  "doctor.oneStep": "הנחיות מותאמות לצמח, צעד אחר צעד.",
  "doctor.differentPlant": "ייתכן שזה צמח אחר.",
  "doctor.identityUnknown": "זהות הצמח לא אומתה.",
  "doctor.identityFallback": "המין אינו ודאי; ההנחיות מבוססות על התסמינים הנראים.",
  "doctor.diagnosedAlt": "התמונה שאובחנה עבור {{name}}",
  "doctor.assessmentFor": "אבחון עבור {{name}}",
  "doctor.careConfidence": "רמת ביטחון בטיפול: {{value}}",
  "doctor.routine": "טיפול שגרתי",
  "doctor.soon": "תשומת לב בקרוב",
  "doctor.urgent": "לטפל היום",
  "doctor.now": "מה לעשות עכשיו",
  "doctor.why": "למה ייתכן שזה קורה",
  "doctor.avoid": "ממה להימנע",
  "doctor.expected": "שיפור צפוי",
  "doctor.reassess": "מתי לבדוק שוב",
  "doctor.observations": "ממצאים נראים",
  "doctor.issues": "גורמים אפשריים",
  "doctor.watering": "תוכנית השקיה",
  "doctor.notificationPoint": "נקודת התראה מוצעת",
  "doctor.checkPot": "תחילה לבדוק את העציץ",
  "doctor.ifWater": "אם הגיע הזמן להשקות",
  "doctor.ifWet": "אם המצע נשאר רטוב מדי",
  "doctor.tokens": "{{count}} טוקנים",
  "doctor.usageUnavailable": "נתוני שימוש אינם זמינים",
  "doctor.neurons": "{{count}} נוירונים",
  "doctor.cloudflareFallback": " · נעשה שימוש חלופי ב־Cloudflare; נתוני השימוש מתייחסים לספק זה בלבד.",
};

function detectedLocale(): Locale {
  try {
    if (window.parent !== window) {
      const parentLanguage = window.parent.document.documentElement.lang;
      if (parentLanguage) return parentLanguage.toLowerCase().startsWith("he") ? "he" : "en";
    }
  } catch {
    // A cross-origin embedding cannot expose its document; continue with HA storage.
  }
  try {
    const stored = window.localStorage.getItem("selectedLanguage");
    const selected = stored ? JSON.parse(stored) : null;
    if (typeof selected === "string") return selected.toLowerCase().startsWith("he") ? "he" : "en";
  } catch {
    // Storage may be unavailable in private browsing; use the browser locale.
  }
  return navigator.language.toLowerCase().startsWith("he") ? "he" : "en";
}

type Translate = (key: string, fallback: string, values?: Record<string, string | number>) => string;
type I18nValue = { locale: Locale; t: Translate };

function interpolate(value: string, values: Record<string, string | number> = {}) {
  return value.replace(/{{(\w+)}}/g, (_match, key: string) => String(values[key] ?? ""));
}

const defaultValue: I18nValue = {
  locale: detectedLocale(),
  t: (key, fallback, values) => interpolate(detectedLocale() === "he" ? (he[key] ?? fallback) : fallback, values),
};

const I18nContext = createContext(defaultValue);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectedLocale);
  useEffect(() => {
    const refresh = () => setLocale(detectedLocale());
    let parentObserver: MutationObserver | undefined;
    try {
      if (window.parent !== window) {
        parentObserver = new MutationObserver(refresh);
        parentObserver.observe(window.parent.document.documentElement, {
          attributeFilter: ["lang"],
        });
      }
    } catch {
      // Cross-origin parents are covered by storage/browser fallbacks.
    }
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      parentObserver?.disconnect();
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
  }, [locale]);
  const t: Translate = (key, fallback, values) => interpolate(locale === "he" ? (he[key] ?? fallback) : fallback, values);
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

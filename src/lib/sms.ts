/**
 * SMS SIMULYATSIYA MODULI
 * ------------------------
 * Loyihada haqiqiy SMS-shlyuz (masalan Eskiz.uz, Play Mobile) ulanmagan,
 * shuning uchun SMS yuborish jarayoni SIMULYATSIYA qilinadi: xabar
 * konsolga chiqariladi va "sms_logs" jadvaliga (yoki backend mavjud
 * bo'lmasa localStorage'ga) yoziladi, shunda Ega/Usta panelida "yuborilgan
 * SMS'lar" jurnalini ko'rish orqali funksiyani real hayotda qanday
 * ishlashini ko'rish mumkin.
 *
 * Haqiqiy SMS-provayderga ulash kerak bo'lsa, faqat shu faylning ichini
 * (masalan `sendSmsViaProvider` funksiyasini) o'zgartirish kifoya —
 * qolgan barcha kod (navbat, bildirishnoma triggerlari) o'zgarishsiz qoladi.
 */
import { SmsLog } from '../types';

const STORAGE_KEY_SMS_LOG = 'navbat_sms_log_local_v1';

function getLocalSmsLog(): SmsLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SMS_LOG);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveLocalSmsLog(logs: SmsLog[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SMS_LOG, JSON.stringify(logs.slice(0, 200)));
  } catch {
    // ignore
  }
}

/**
 * Mijozga (simulyatsiya qilingan) SMS yuboradi. Avval backendga urinadi,
 * agar backend mavjud bo'lmasa (offline demo) — localStorage fallback.
 */
export async function sendSms(params: {
  appointment_id: string;
  phone: string;
  message: string;
  kind: SmsLog['kind'];
}): Promise<SmsLog> {
  // Har doim konsolga ham chiqaramiz — demo/dev paytida ko'rinishi uchun.
  // eslint-disable-next-line no-console
  console.log(`📲 [SMS SIMULYATSIYASI] -> ${params.phone}: "${params.message}"`);

  try {
    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // backend mavjud emas — fallback
  }

  const log: SmsLog = {
    id: 'sms_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    appointment_id: params.appointment_id,
    phone: params.phone,
    message: params.message,
    kind: params.kind,
    created_at: new Date().toISOString(),
  };
  const logs = getLocalSmsLog();
  logs.unshift(log);
  saveLocalSmsLog(logs);
  return log;
}

export async function getSmsLogs(): Promise<SmsLog[]> {
  try {
    const res = await fetch('/api/sms/logs');
    if (res.ok) {
      const logs = await res.json();
      saveLocalSmsLog(logs);
      return logs;
    }
  } catch {
    // fallback
  }
  return getLocalSmsLog();
}

/** Tayyor SMS matnlari — barchasi o'zbek tilida, mijozga tushunarli va qisqa. */
export const SMS_TEMPLATES = {
  queueJoined: (position: number, etaMinutes: number, businessName: string) =>
    position === 0
      ? `${businessName}: Navbatingiz keldi! Iltimos, hoziroq keling.`
      : `${businessName}: Siz jonli navbatga yozildingiz. Sizdan oldin ${position} kishi bor. Taxminiy kutish vaqti: ~${etaMinutes} daqiqa.`,
  almostYourTurn: (businessName: string, minutesLeft: number = 15) =>
    `${businessName}: Sizga taxminan ${minutesLeft} daqiqa qoldi. Iltimos, sartaroshxonaga yaqinlashing!`,
  yourTurn: (businessName: string) =>
    `${businessName}: Sizning navbatingiz keldi! Iltimos, hoziroq kassaga/kresloga keling.`,
};

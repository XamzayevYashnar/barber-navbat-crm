import {
  Appointment,
  AppointmentStatus,
  DailySummary,
  DayRevenue,
  Master,
  MasterDailyPerformance,
  Service,
} from '../types';

/**
 * Ustaning bir kunlik navbatlari, start_at bo'yicha tartiblangan.
 */
export function getMasterDay(
  masterId: string,
  dayDateStr: string, // "YYYY-MM-DD"
  allAppointments: Appointment[]
): Appointment[] {
  return allAppointments
    .filter((app) => {
      if (app.master_id !== masterId) return false;
      const appDate = new Date(app.start_at).toISOString().slice(0, 10);
      return appDate === dayDateStr;
    })
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
}

/**
 * Mijozning oldida nechta aktiv navbat borligini qaytaradi.
 */
export function getQueuePosition(
  appointment: Appointment,
  allAppointments: Appointment[],
  services: Service[] = [],
  now: Date = new Date()
): {
  position: number; // 0 means currently being served or next (no one ahead), 1 = 1 person ahead, etc.
  isNext: boolean; // true only when it's this client's actual turn (no one ahead, master is free)
  isCurrent: boolean;
  estimatedWaitMinutes: number;
} {
  // "Aqlli algoritm": aniq xizmat davomiyligi noma'lum bo'lgan holatlarda,
  // 30 daqiqalik qattiq kodlangan taxmin o'rniga ustaning HAQIQIY o'rtacha
  // ishlash tezligidan foydalanamiz.
  const masterAvgPace = getMasterAveragePaceMinutes(appointment.master_id, allAppointments, 30);

  const durationFor = (app: Appointment): number => {
    const svc = services.find((s) => s.id === app.service_id);
    if (svc && svc.duration_minutes > 0) return svc.duration_minutes;
    const ms = new Date(app.end_at).getTime() - new Date(app.start_at).getTime();
    const mins = Math.round(ms / 60000);
    return mins > 0 ? mins : masterAvgPace; // fallback: ustaning o'rtacha tezligi
  };

  if (appointment.status === AppointmentStatus.IN_PROGRESS) {
    return {
      position: 0,
      isNext: false,
      isCurrent: true,
      estimatedWaitMinutes: 0,
    };
  }

  if (appointment.status !== AppointmentStatus.BOOKED) {
    return {
      position: 0,
      isNext: false,
      isCurrent: false,
      estimatedWaitMinutes: 0,
    };
  }

  const apptDateStr = new Date(appointment.start_at).toISOString().slice(0, 10);
  const apptStart = new Date(appointment.start_at).getTime();

  // Shu ustadagi bugungi barcha navbatlar
  const masterDayAppts = allAppointments.filter((app) => {
    if (app.master_id !== appointment.master_id) return false;
    const dateStr = new Date(app.start_at).toISOString().slice(0, 10);
    return dateStr === apptDateStr;
  });

  // Hozir xizmatda bo'lgan mijoz bormi?
  const inProgressAppt = masterDayAppts.find(
    (app) => app.status === AppointmentStatus.IN_PROGRESS
  );

  // Shu mijozdan oldingi BOOKED navbatlar
  const earlierBooked = masterDayAppts.filter((app) => {
    if (app.id === appointment.id) return false;
    if (app.status !== AppointmentStatus.BOOKED) return false;
    return new Date(app.start_at).getTime() < apptStart;
  });

  const position = earlierBooked.length + (inProgressAppt ? 1 : 0);

  // "Navbatingiz keldi" faqat hech kim oldinda bo'lmasa VA usta band bo'lmasa (ya'ni
  // hozir hech kimga xizmat ko'rsatilmayotgan bo'lsa) chiqishi kerak — aks holda
  // usta band bo'lsa ham mijozga "0" ko'rsatib, uni chalg'itib qo'yamiz.
  const isNext = position === 0 && !inProgressAppt;

  // Taxminiy kutish vaqti: har bir mijozning REAL xizmat davomiyligini hisobga oladi
  // (hammasiga bir xil 30 daqiqa deb hisoblash o'rniga), shu jumladan hozir
  // xizmatda bo'lgan mijozning qolgan vaqti.
  let estimatedWaitMinutes = 0;
  if (inProgressAppt) {
    const inProgressDurationMin = durationFor(inProgressAppt);
    const inProgressStart = new Date(inProgressAppt.start_at).getTime();
    const elapsedMin = Math.max(0, (now.getTime() - inProgressStart) / 60000);
    estimatedWaitMinutes += Math.max(0, Math.round(inProgressDurationMin - elapsedMin));
  }
  estimatedWaitMinutes += earlierBooked.reduce((sum, app) => sum + durationFor(app), 0);

  return {
    position,
    isNext,
    isCurrent: false,
    estimatedWaitMinutes,
  };
}

/**
 * "Aqlli algoritm": Ustaning so'nggi N ta yakunlangan (DONE) mijozidan kelib
 * chiqib, uning bitta mijozga o'rtacha qancha vaqt sarflashini (daqiqada)
 * hisoblaydi. Bu Dinamik Navbat rejimida taxminiy kutish vaqtini aniqroq
 * ko'rsatish uchun ishlatiladi — belgilangan xizmat davomiyligi o'rniga
 * ustaning HAQIQIY tezligiga tayanadi.
 *
 * Hisoblash uchun `started_at` (usta "Boshladim" bosgan payt) va
 * `finished_at` (usta "Tugatdim" bosgan payt) orasidagi haqiqiy farq
 * ishlatiladi. Agar bu maydonlar mavjud bo'lmagan eski yozuvlar bo'lsa,
 * fallback sifatida start_at/end_at farqi olinadi.
 */
export function getMasterAveragePaceMinutes(
  masterId: string,
  allAppointments: Appointment[],
  fallbackMinutes: number = 30,
  sampleSize: number = 15
): number {
  const doneAppts = allAppointments
    .filter((a) => a.master_id === masterId && a.status === AppointmentStatus.DONE)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, sampleSize);

  if (doneAppts.length === 0) return fallbackMinutes;

  const durations: number[] = [];
  for (const appt of doneAppts) {
    let mins: number | null = null;
    if (appt.started_at && appt.finished_at) {
      const diff = (new Date(appt.finished_at).getTime() - new Date(appt.started_at).getTime()) / 60000;
      if (diff > 0 && diff < 6 * 60) mins = diff; // sog'lom oraliqdagi qiymatlarni olamiz
    }
    if (mins === null) {
      const diff = (new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000;
      if (diff > 0) mins = diff;
    }
    if (mins !== null) durations.push(mins);
  }

  if (durations.length === 0) return fallbackMinutes;

  const avg = durations.reduce((sum, m) => sum + m, 0) / durations.length;
  return Math.max(5, Math.round(avg));
}

/**
 * Berilgan ustaning "bugungi" faol (BOOKED yoki IN_PROGRESS) navbatlari,
 * qo'shilish tartibida (start_at bo'yicha, chunki Jonli Navbat rejimida
 * har bir yangi mijozning start_at qiymati navbatga qo'shilish tartibida
 * hisoblab beriladi — quyidagi createQueueAppointment'ga qarang).
 */
export function getMasterActiveQueue(
  masterId: string,
  dayDateStr: string,
  allAppointments: Appointment[]
): Appointment[] {
  return getMasterDay(masterId, dayDateStr, allAppointments).filter(
    (a) => a.status === AppointmentStatus.BOOKED || a.status === AppointmentStatus.IN_PROGRESS
  );
}

/**
 * Mijoz HALI navbatga qo'shilmasdan turib (Jonli Navbat rejimida "Navbatga
 * yozilish" tugmasini bosishdan oldin) taxminiy holatni ko'rsatish uchun.
 * Usta o'rtacha tezligiga (getMasterAveragePaceMinutes) tayanadi, chunki
 * bu bosqichda mijozning o'zi hali qaysi xizmatni tanlaganini bilamiz, biroq
 * undan OLDINGI navbatdagilarning navbatga qachon yetishi faqat ustaning
 * o'rtacha ishlash tezligi orqaligina taxmin qilinadi.
 */
export function estimateQueueJoinWait(
  masterId: string,
  dayDateStr: string,
  allAppointments: Appointment[],
  now: Date = new Date(),
  fallbackPaceMinutes: number = 30
): { position: number; estimatedWaitMinutes: number; averagePaceMinutes: number } {
  const activeQueue = getMasterActiveQueue(masterId, dayDateStr, allAppointments);
  const avgPace = getMasterAveragePaceMinutes(masterId, allAppointments, fallbackPaceMinutes);

  const inProgress = activeQueue.find((a) => a.status === AppointmentStatus.IN_PROGRESS);
  const booked = activeQueue.filter((a) => a.status === AppointmentStatus.BOOKED);

  let estimatedWaitMinutes = 0;
  if (inProgress) {
    const elapsedMin = Math.max(0, (now.getTime() - new Date(inProgress.start_at).getTime()) / 60000);
    const inProgressPace = avgPace; // ustaning o'rtacha tezligiga asoslanamiz
    estimatedWaitMinutes += Math.max(0, Math.round(inProgressPace - elapsedMin));
  }
  estimatedWaitMinutes += booked.length * avgPace;

  return {
    position: booked.length + (inProgress ? 1 : 0),
    estimatedWaitMinutes: Math.round(estimatedWaitMinutes),
    averagePaceMinutes: avgPace,
  };
}

/**
 * Bir kunlik ko'rsatkichlar: tushum, navbatlar soni, kelmaganlar, ustalar kesimi.
 */
export function getDailySummary(
  businessId: string,
  dayDateStr: string, // "YYYY-MM-DD"
  allAppointments: Appointment[],
  masters: Master[]
): DailySummary {
  const dayAppointments = allAppointments.filter((app) => {
    if (app.business_id !== businessId) return false;
    const dateStr = new Date(app.start_at).toISOString().slice(0, 10);
    return dateStr === dayDateStr;
  });

  let revenue = 0;
  let done = 0;
  let booked = 0;
  let in_progress = 0;
  let no_show = 0;
  let cancelled = 0;

  dayAppointments.forEach((app) => {
    if (app.status === AppointmentStatus.DONE) {
      revenue += app.price_snapshot;
      done++;
    } else if (app.status === AppointmentStatus.BOOKED) {
      booked++;
    } else if (app.status === AppointmentStatus.IN_PROGRESS) {
      in_progress++;
    } else if (app.status === AppointmentStatus.NO_SHOW) {
      no_show++;
    } else if (app.status === AppointmentStatus.CANCELLED) {
      cancelled++;
    }
  });

  const total = dayAppointments.length;
  const activeAndDoneTotal = done + no_show + in_progress + booked;
  const no_show_rate =
    activeAndDoneTotal > 0 ? Math.round((no_show / activeAndDoneTotal) * 1000) / 10 : 0;

  const by_master: MasterDailyPerformance[] = masters.map((master) => {
    const masterAppts = dayAppointments.filter((a) => a.master_id === master.id);
    const mDone = masterAppts.filter((a) => a.status === AppointmentStatus.DONE);
    const mInProgress = masterAppts.filter((a) => a.status === AppointmentStatus.IN_PROGRESS);
    const mRevenue = mDone.reduce((sum, a) => sum + a.price_snapshot, 0);

    return {
      master_id: master.id,
      master_name: master.display_name,
      total_count: masterAppts.length,
      done_count: mDone.length,
      in_progress_count: mInProgress.length,
      revenue: mRevenue,
    };
  });

  return {
    date: dayDateStr,
    revenue,
    total,
    done,
    booked,
    in_progress,
    no_show,
    cancelled,
    no_show_rate,
    by_master,
  };
}

const UZ_DAY_NAMES = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];

/**
 * Oxirgi 7 kunning kunlik tushumi — grafik uchun.
 */
export function getLast7Days(
  businessId: string,
  allAppointments: Appointment[],
  referenceDate: Date = new Date()
): DayRevenue[] {
  const result: DayRevenue[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayName = UZ_DAY_NAMES[d.getDay()];

    const dayAppointments = allAppointments.filter((app) => {
      if (app.business_id !== businessId) return false;
      const appDateStr = new Date(app.start_at).toISOString().slice(0, 10);
      return appDateStr === dateStr;
    });

    const doneAppts = dayAppointments.filter((a) => a.status === AppointmentStatus.DONE);
    const revenue = doneAppts.reduce((sum, a) => sum + a.price_snapshot, 0);

    result.push({
      date: dateStr,
      day_name: dayName,
      revenue,
      count: dayAppointments.length,
      done_count: doneAppts.length,
    });
  }

  return result;
}

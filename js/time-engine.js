window.TimeEngine = (function () {
  'use strict';

  const partsFormatterCache = new Map();

  function getPartsFormatter(tz) {
    if (!partsFormatterCache.has(tz)) {
      partsFormatterCache.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        })
      );
    }
    return partsFormatterCache.get(tz);
  }

  function extractWallParts(utcDate, tz) {
    const parts = getPartsFormatter(tz).formatToParts(utcDate);
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = parseInt(p.value, 10);
      }
    }
    return {
      year: map.year,
      month: map.month,
      day: map.day,
      hour: map.hour === 24 ? 0 : map.hour,
      minute: map.minute,
      second: map.second
    };
  }

  /**
   * Returns offset in minutes (e.g. Cairo = +120, New York = -300 or -240)
   * at the given UTC instant.
   */
  function getOffsetMinutes(utcDate, tz) {
    const w = extractWallParts(utcDate, tz);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    const utcAligned = Date.UTC(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth(),
      utcDate.getUTCDate(),
      utcDate.getUTCHours(),
      utcDate.getUTCMinutes(),
      utcDate.getUTCSeconds()
    );
    return Math.round((asUtc - utcAligned) / 60000);
  }

  /**
   * Converts wall-clock date/time in sourceTz to an exact UTC Date object.
   */
  function wallTimeToUtcDate(year, month, day, hour, minute, second, sourceTz) {
    const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    const off1 = getOffsetMinutes(new Date(approxUtc), sourceTz);
    const candidate = approxUtc - off1 * 60000;
    const off2 = getOffsetMinutes(new Date(candidate), sourceTz);
    return new Date(approxUtc - off2 * 60000);
  }

  function formatUtcOffset(offsetMinutes) {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const m = String(abs % 60).padStart(2, '0');
    return `UTC${sign}${h}:${m}`;
  }

  function isDstActive(utcDate, tz) {
    const jan = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1, 12, 0, 0));
    const jul = new Date(Date.UTC(utcDate.getUTCFullYear(), 6, 1, 12, 0, 0));
    const offJan = getOffsetMinutes(jan, tz);
    const offJul = getOffsetMinutes(jul, tz);
    if (offJan === offJul) return false;
    const currentOff = getOffsetMinutes(utcDate, tz);
    return currentOff === Math.max(offJan, offJul);
  }

  function getSolarPhase(hour) {
    if (hour >= 5 && hour < 7) return 'dawn';
    if (hour >= 7 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'evening';
    return 'night';
  }

  function getWorkStatus(hour) {
    if (hour >= 9 && hour < 17) return 'work';
    if (hour >= 7 && hour < 23) return 'awake';
    return 'sleep';
  }

  function formatCityInstant(utcDate, tz, refTz, lang, use24h) {
    const wall = extractWallParts(utcDate, tz);
    const refWall = extractWallParts(utcDate, refTz);

    const offsetMins = getOffsetMinutes(utcDate, tz);
    const refOffsetMins = getOffsetMinutes(utcDate, refTz);
    const diffMins = offsetMins - refOffsetMins;

    // Day shift relative to reference city's calendar date
    const targetDayUtc = Date.UTC(wall.year, wall.month - 1, wall.day);
    const refDayUtc = Date.UTC(refWall.year, refWall.month - 1, refWall.day);
    const dayShift = Math.round((targetDayUtc - refDayUtc) / 86400000);

    const locale = lang === 'ar' ? 'ar-EG' : 'en-US';

    const timeStr = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: !use24h
    }).format(utcDate);

    const timeWithSecStr = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: !use24h
    }).format(utcDate);

    const dateStr = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(utcDate);

    const isoDate = `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
    const isoTime = `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;

    return {
      wall,
      timeStr,
      timeWithSecStr,
      dateStr,
      isoDate,
      isoTime,
      offsetMins,
      utcOffsetLabel: formatUtcOffset(offsetMins),
      diffMins,
      dayShift,
      dst: isDstActive(utcDate, tz),
      phase: getSolarPhase(wall.hour),
      status: getWorkStatus(wall.hour)
    };
  }

  function formatDiffText(diffMins, t) {
    if (diffMins === 0) return t.sameTime;
    const prefix = diffMins > 0 ? t.aheadBy : t.behindBy;
    const abs = Math.abs(diffMins);
    const hrs = Math.floor(abs / 60);
    const mins = abs % 60;

    const parts = [];
    if (hrs > 0) {
      parts.push(`${hrs} ${hrs === 1 ? t.hourSingular : t.hourPlural}`);
    }
    if (mins > 0) {
      parts.push(`${mins} ${mins === 1 ? t.minuteSingular : t.minutePlural}`);
    }
    return `${prefix} ${parts.join(` ${t.andWord} `)}`;
  }

  function formatShortDiffBadge(diffMins) {
    if (diffMins === 0) return '±0h';
    const sign = diffMins > 0 ? '+' : '-';
    const abs = Math.abs(diffMins);
    const hrs = Math.floor(abs / 60);
    const mins = abs % 60;
    return mins > 0 ? `${sign}${hrs}h ${mins}m` : `${sign}${hrs}h`;
  }

  function findCityByTimezone(tz) {
    return (
      window.WORLD_CITIES.find((c) => c.tz === tz) || window.WORLD_CITIES[0]
    );
  }

  return {
    extractWallParts,
    getOffsetMinutes,
    wallTimeToUtcDate,
    formatUtcOffset,
    formatCityInstant,
    formatDiffText,
    formatShortDiffBadge,
    findCityByTimezone
  };
})();

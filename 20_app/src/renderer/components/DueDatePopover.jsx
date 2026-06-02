import React, { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const TIME_OPTIONS = [{ label: "時刻なし", value: "" }].concat(
  Array.from({ length: 48 }, (_, index) => {
    const hour = String(Math.floor(index / 2)).padStart(2, "0");
    const minute = index % 2 === 0 ? "00" : "30";
    const value = `${hour}:${minute}`;
    return { label: value, value };
  })
);

function splitDueValue(value) {
  if (!value) return { datePart: "", timePart: "" };
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (!match) return { datePart: "", timePart: "" };
  return { datePart: match[1] || "", timePart: match[2] || "" };
}

function toDueValue(datePart, timePart) {
  if (!datePart) return null;
  return timePart ? `${datePart}T${timePart}` : datePart;
}

function parseDatePart(datePart) {
  if (!datePart) return null;
  const match = String(datePart).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function formatDatePart(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function buildCalendarDays(viewMonth) {
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startDay = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(startDay, index));
}

function isSameDay(left, right) {
  return Boolean(left) && Boolean(right)
    && left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatSummary(datePart, timeEnabled, timePart) {
  if (!datePart) return "日付なし";
  return timeEnabled && timePart ? `${datePart} ${timePart}` : datePart;
}

function parseSummaryInput(inputValue) {
  const raw = String(inputValue || "").trim();
  if (!raw) return { valid: true, datePart: "", timePart: "", timeEnabled: false };

  const normalized = raw.replace(/\//g, "-").replace(/[Tt]/g, " ").replace(/\s+/g, " ");
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s(\d{2}:\d{2}))?$/);
  if (!match) return { valid: false };

  const datePart = match[1];
  const date = parseDatePart(datePart);
  if (!date || formatDatePart(date) !== datePart) return { valid: false };

  const timePart = match[2] || "";
  if (timePart) {
    const timeMatch = timePart.match(/^(\d{2}):(\d{2})$/);
    if (!timeMatch) return { valid: false };
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { valid: false };
  }

  return {
    valid: true,
    datePart,
    timePart,
    timeEnabled: Boolean(timePart),
  };
}

function DueDatePopover({ value, onChange, onClear, onClose, className = "", placementMode = "anchored" }) {
  const popoverRef = useRef(null);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const initial = useMemo(() => splitDueValue(value), [value]);
  const [selectedDatePart, setSelectedDatePart] = useState(initial.datePart);
  const [timeEnabled, setTimeEnabled] = useState(Boolean(initial.timePart));
  const [timePart, setTimePart] = useState(initial.timePart || "12:00");
  const [viewMonth, setViewMonth] = useState(() => parseDatePart(initial.datePart) || today);
  const [timeListOpen, setTimeListOpen] = useState(false);
  const [inputValue, setInputValue] = useState(formatSummary(initial.datePart, Boolean(initial.timePart), initial.timePart || "12:00"));
  const [inputError, setInputError] = useState("");
  const [floatingStyle, setFloatingStyle] = useState(null);

  useEffect(() => {
    const next = splitDueValue(value);
    setSelectedDatePart(next.datePart);
    setTimeEnabled(Boolean(next.timePart));
    setTimePart(next.timePart || "12:00");
    setViewMonth(parseDatePart(next.datePart) || today);
    setTimeListOpen(false);
    setInputValue(formatSummary(next.datePart, Boolean(next.timePart), next.timePart || "12:00"));
    setInputError("");
  }, [value, today]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const handleMouseDown = (e) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target)) onClose?.();
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);
  const selectedDate = parseDatePart(selectedDatePart);

  useEffect(() => {
    if (placementMode !== "main-auto") {
      setFloatingStyle(null);
      return undefined;
    }

    const updatePosition = () => {
      if (!popoverRef.current) return;
      const anchorEl = popoverRef.current.parentElement;
      if (!anchorEl) return;

      const gap = 8;
      const margin = 8;
      const anchorRect = anchorEl.getBoundingClientRect();
      const dialogRect = popoverRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - margin;

      let top;
      if (spaceBelow >= dialogRect.height || spaceBelow >= spaceAbove) {
        top = Math.min(anchorRect.bottom + gap, window.innerHeight - dialogRect.height - margin);
      } else {
        top = Math.max(margin, anchorRect.top - dialogRect.height - gap);
      }

      let left = anchorRect.right - dialogRect.width;
      left = Math.max(margin, Math.min(left, window.innerWidth - dialogRect.width - margin));

      setFloatingStyle({
        position: "fixed",
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
      });
    };

    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [placementMode, timeListOpen, inputError, selectedDatePart, timeEnabled, timePart, viewMonth]);

  useEffect(() => {
    setInputValue(formatSummary(selectedDatePart, timeEnabled, timePart));
  }, [selectedDatePart, timeEnabled, timePart]);

  const handleSelectDate = (date) => {
    setSelectedDatePart(formatDatePart(date));
    setInputError("");
  };

  const commitDueValue = (datePart, nextTimeEnabled = timeEnabled, nextTimePart = timePart) => {
    if (!datePart) return;
    onChange?.(toDueValue(datePart, nextTimeEnabled ? nextTimePart : ""));
  };

  const applyShortcut = (type) => {
    let nextDate = selectedDate || today;
    if (type === "today") nextDate = today;
    if (type === "tomorrow") nextDate = addDays(today, 1);
    if (type === "week") nextDate = addDays(today, 7);
    const nextDatePart = formatDatePart(nextDate);
    const nextTimeEnabled = type === "date-only" ? false : timeEnabled;
    setTimeEnabled(nextTimeEnabled);
    setSelectedDatePart(nextDatePart);
    setViewMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setInputError("");
    if (type === "today" || type === "tomorrow" || type === "week" || type === "date-only") {
      commitDueValue(nextDatePart, nextTimeEnabled, timePart);
    }
  };

  const handleInputChange = (nextValue) => {
    setInputValue(nextValue);
    if (!String(nextValue).trim()) {
      setInputError("");
      setSelectedDatePart("");
      setTimeEnabled(false);
      return;
    }

    const parsed = parseSummaryInput(nextValue);
    if (!parsed.valid) {
      setInputError("YYYY-MM-DD または YYYY-MM-DD HH:MM で入力してください。");
      return;
    }

    setInputError("");
    setSelectedDatePart(parsed.datePart);
    setTimeEnabled(parsed.timeEnabled);
    setTimePart(parsed.timePart || "12:00");
    if (parsed.datePart) {
      const nextDate = parseDatePart(parsed.datePart);
      if (nextDate) setViewMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    }
  };

  const handleTimeSelect = (nextTime) => {
    if (!selectedDatePart) return;
    setTimeEnabled(Boolean(nextTime));
    if (nextTime) setTimePart(nextTime);
    setTimeListOpen(false);
    setInputError("");
  };

  const handleConfirm = () => {
    const parsed = parseSummaryInput(inputValue);
    if (!parsed.valid) {
      setInputError("YYYY-MM-DD または YYYY-MM-DD HH:MM で入力してください。");
      return;
    }
    onChange?.(toDueValue(selectedDatePart, timeEnabled ? timePart : ""));
  };

  return (
    <div
      ref={popoverRef}
      className={`due-dialog ${className}`.trim()}
      style={floatingStyle || undefined}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
        <div className="due-dialog-shortcuts" aria-label="日付ショートカット">
          <button type="button" className="due-dialog-shortcut" onClick={() => applyShortcut("today")}>
            <span className="due-dialog-shortcut-icon">☀</span>
            <span className="due-dialog-shortcut-label">今日</span>
          </button>
          <button type="button" className="due-dialog-shortcut" onClick={() => applyShortcut("tomorrow")}>
            <span className="due-dialog-shortcut-icon">⇢</span>
            <span className="due-dialog-shortcut-label">明日</span>
          </button>
          <button type="button" className="due-dialog-shortcut" onClick={() => applyShortcut("week")}>
            <span className="due-dialog-shortcut-icon">＋7</span>
            <span className="due-dialog-shortcut-label">1週間後</span>
          </button>
          <button type="button" className="due-dialog-shortcut" onClick={() => applyShortcut("date-only")}>
            <span className="due-dialog-shortcut-icon">◐</span>
            <span className="due-dialog-shortcut-label">日付のみ</span>
          </button>
        </div>

        <div className="due-dialog-calendar">
          <div className="due-dialog-calendar-header">
            <div className="due-dialog-calendar-title">{viewMonth.getFullYear()}年{viewMonth.getMonth() + 1}月</div>
            <div className="due-dialog-calendar-nav">
              <button type="button" className="due-dialog-icon-btn" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} aria-label="前月">
                ‹
              </button>
              <button type="button" className="due-dialog-icon-btn" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} aria-label="次月">
                ›
              </button>
            </div>
          </div>

          <div className="due-dialog-weekdays">
            {WEEKDAYS.map((day) => (
              <span key={day} className="due-dialog-weekday">{day}</span>
            ))}
          </div>

          <div className="due-dialog-days">
            {calendarDays.map((day) => {
              const isCurrentMonth = day.getMonth() === viewMonth.getMonth();
              const className = [
                "due-dialog-day",
                !isCurrentMonth ? "is-muted" : "",
                isSameDay(day, today) ? "is-today" : "",
                isSameDay(day, selectedDate) ? "is-selected" : "",
              ].filter(Boolean).join(" ");

              return (
                <button key={formatDatePart(day)} type="button" className={className} onClick={() => handleSelectDate(day)}>
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        <div className="due-dialog-summary">
          <div className="due-dialog-summary-row">
            <div className="due-dialog-summary-label">選択結果</div>
            <input
              className={`due-dialog-summary-input${inputError ? " is-invalid" : ""}`}
              type="text"
              value={inputValue}
              placeholder="YYYY-MM-DD または YYYY-MM-DD HH:MM"
              onChange={(e) => handleInputChange(e.target.value)}
            />
          </div>
          {inputError && <div className="due-dialog-summary-error">{inputError}</div>}
        </div>

        <div className="due-dialog-time-block">
          <button type="button" className="due-dialog-time-row" onClick={() => selectedDatePart && setTimeListOpen((prev) => !prev)}>
            <span className="due-dialog-time-row-main">
              <span className="due-dialog-time-icon">◷</span>
              <span className="due-dialog-time-labels">
                <strong>{timeEnabled ? timePart : "時刻なし"}</strong>
                <span>時刻設定</span>
              </span>
            </span>
            <span>›</span>
          </button>

          {timeListOpen && (
            <div className="due-dialog-time-list" role="listbox" aria-label="時刻候補">
              {TIME_OPTIONS.map((option) => {
                const selected = option.value ? (timeEnabled && timePart === option.value) : !timeEnabled;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={`due-dialog-time-option${selected ? " is-selected" : ""}`}
                    onClick={() => handleTimeSelect(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="due-dialog-footer">
          <button type="button" className="due-dialog-btn due-dialog-btn--clear" onClick={() => onClear?.()}>
            クリア
          </button>
          <button type="button" className="due-dialog-btn due-dialog-btn--ok" onClick={handleConfirm} disabled={!selectedDatePart || Boolean(inputError)}>
            OK
          </button>
        </div>
    </div>
  );
}

export default DueDatePopover;

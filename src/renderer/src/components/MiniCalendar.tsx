import { CalendarDays } from "lucide-react";
import { Eyebrow } from "./ui";

export function MiniCalendar({ today }: { today: Date }) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = Array.from({ length: 42 }, (_, index) => new Date(year, month, index - firstWeekday + 1));
  const monthLabel = today.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return <section className="mini-calendar" aria-label={`${monthLabel} calendar`}>
    <header><Eyebrow>{monthLabel}</Eyebrow><CalendarDays /></header>
    <div className="calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
    <div className="calendar-days">{days.map((day) => <span key={day.toISOString()} className={`${day.getMonth() === month ? "" : "outside"} ${sameDay(day, today) ? "today" : ""}`}>{day.getDate()}</span>)}</div>
  </section>;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

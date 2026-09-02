"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventSourceFuncArg, EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function CalendarView({
  canViewAll,
  assignableUsers,
}: {
  canViewAll: boolean;
  assignableUsers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const calendarRef = React.useRef<FullCalendar | null>(null);
  const [selectedUserId, setSelectedUserId] = React.useState("all");

  function fetchEvents(
    fetchInfo: EventSourceFuncArg,
    successCallback: (events: EventInput[]) => void,
    failureCallback: (error: Error) => void,
  ) {
    const params = new URLSearchParams({
      start: fetchInfo.startStr,
      end: fetchInfo.endStr,
    });
    if (canViewAll && selectedUserId !== "all") {
      params.set("userId", selectedUserId);
    }
    fetch(`/api/appointments?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("تعذّر تحميل المواعيد");
        return res.json();
      })
      .then(successCallback)
      .catch(failureCallback);
  }

  function handleEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault();
    const jobHref = info.event.extendedProps.jobHref as string | undefined;
    if (jobHref) router.push(jobHref);
  }

  return (
    <div className="space-y-4">
      {canViewAll && assignableUsers.length > 0 && (
        <div className="flex items-center gap-2">
          <Label htmlFor="technician-filter" className="whitespace-nowrap">
            الفني
          </Label>
          <Select
            value={selectedUserId}
            onValueChange={(value) => {
              setSelectedUserId(value);
              calendarRef.current?.getApi().refetchEvents();
            }}
          >
            <SelectTrigger id="technician-filter" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الجميع</SelectItem>
              {assignableUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="rounded-xl border bg-card p-2 sm:p-4">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          direction="rtl"
          height="auto"
          locale="ar"
          firstDay={0}
          headerToolbar={{
            start: "title",
            center: "",
            end: "today prev,next dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: "اليوم",
            month: "شهر",
            week: "أسبوع",
            day: "يوم",
            list: "قائمة",
          }}
          events={fetchEvents}
          eventClick={handleEventClick}
        />
      </div>
    </div>
  );
}

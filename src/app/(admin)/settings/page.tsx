import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { toId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { CURRENCY, LOCALE, formatMoney } from "@/lib/money";
import { getNotificationSettings } from "@/lib/notification-sync";
import { getReminderTemplate } from "@/lib/reminders";
import { addMonths, localToday, monthOf } from "@/lib/rent";
import {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_REMINDER_TEMPLATE,
  REMINDER_PLACEHOLDERS,
  renderTemplate,
  reminderVars,
} from "@/lib/whatsapp";
import { User } from "@/models/User";
import { ActionForm, CheckboxField, ConfirmAction, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { EnableDesktopButton } from "@/components/notifications";
import { Badge, Card, DetailList, PageHeader } from "@/components/ui";
import { changePassword, createAdmin, resetReminderTemplate, saveNotificationSettings, saveReminderTemplate } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  await connectDB();
  const [admins, template, notif] = await Promise.all([
    User.find().sort({ createdAt: 1 }).select("name email createdAt").lean(),
    getReminderTemplate(),
    getNotificationSettings(),
  ]);
  const sampleMonth = addMonths(monthOf(localToday()), -1);
  const preview = renderTemplate(
    template,
    reminderVars(
      {
        kind: "overdue",
        months: [{ month: sampleMonth, dueDate: `${sampleMonth}-05`, balance: 1500000 }],
        amount: 1500000,
        dueDate: `${sampleMonth}-05`,
      },
      "Asha Menon",
      "Palm Grove Villa",
    ),
  );
  const isDefault = template === DEFAULT_REMINDER_TEMPLATE;

  return (
    <>
      <PageHeader title="Settings" description="Admin accounts and your password." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Admin accounts" description="Everyone here can manage all properties." bodyClassName="p-0">
          <ul className="divide-y divide-slate-100">
            {admins.map((a) => (
              <li key={toId(a._id)} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {a.name} {toId(a._id) === me.id && <Badge tone="brand">You</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{a.email}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">Since {formatDate(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Add admin" description="They can sign in immediately with this password.">
          <ActionForm action={createAdmin} className="space-y-4">
            <TextField name="name" label="Name" autoComplete="off" />
            <TextField name="email" label="Email" type="email" autoComplete="off" />
            <TextField name="password" label="Temporary password" type="password" autoComplete="new-password" hint="At least 8 characters." />
            <div className="flex justify-end">
              <SubmitButton>Add admin</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Change your password">
          <ActionForm action={changePassword} className="space-y-4">
            <TextField name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
            <TextField name="newPassword" label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." />
            <TextField name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" />
            <div className="flex justify-end">
              <SubmitButton>Update password</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card
          title="WhatsApp reminders"
          description="Message used by the “Remind on WhatsApp” buttons. It opens WhatsApp with this text; you press send."
          className="lg:col-span-2"
          actions={
            !isDefault ? (
              <ConfirmAction
                action={resetReminderTemplate}
                label="Reset to default"
                confirmLabel="Reset"
                prompt="Use the default message?"
              />
            ) : undefined
          }
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ActionForm action={saveReminderTemplate} className="space-y-4">
              <TextAreaField
                name="reminderTemplate"
                label="Message template"
                rows={6}
                defaultValue={template}
                hint={<>Placeholders: {REMINDER_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}</>}
              />
              <div className="flex justify-end">
                <SubmitButton>Save template</SubmitButton>
              </div>
            </ActionForm>
            <div>
              <p className="label">Preview</p>
              <div className="rounded-2xl bg-[#e7f7e1] p-4 text-sm whitespace-pre-line text-slate-800 shadow-inner ring-1 ring-emerald-900/5">
                {preview}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Sample data. {"{amount}"} is the outstanding total, {"{months}"} the unpaid months, {"{dueDate}"} the earliest unpaid due
                date. 10-digit phone numbers get country code +{DEFAULT_COUNTRY_CODE}.
              </p>
            </div>
          </div>
        </Card>

        <Card
          title="Notifications"
          description="When Rentee raises alerts and reminders. Changes apply immediately."
          className="lg:col-span-2"
        >
          <ActionForm action={saveNotificationSettings} className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <TextField
                name="dueSoonDays"
                label="Rent due reminder (days before)"
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                defaultValue={notif.dueSoonDays}
                hint="0 = on the due date only."
              />
              <TextField
                name="moveOutDays"
                label="Move-out reminder (days before)"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                defaultValue={notif.moveOutDays}
              />
              <TextField
                name="maintenanceDays"
                label="Repair alert after (days open)"
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                defaultValue={notif.maintenanceDays}
                hint="Urgent and high-priority requests alert immediately."
              />
            </div>
            <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70 sm:flex-row sm:items-center sm:justify-between">
              <CheckboxField
                name="desktopNotifications"
                label="Desktop notifications"
                description="Show browser notifications for new alerts while a Rentee tab is open. Each browser must also allow them."
                defaultChecked={notif.desktopNotifications}
              />
              <EnableDesktopButton className="shrink-0" />
            </div>
            <div className="flex justify-end">
              <SubmitButton>Save notification settings</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Preferences" description="Configured through environment variables.">
          <DetailList
            items={[
              { label: "Currency", value: `${CURRENCY} (e.g. ${formatMoney(1234567)})` },
              { label: "Locale", value: LOCALE },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { TriangleAlert, Gift } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getAllSettings } from "@/server/settings";
import {
  getAllJobStatusesIncludingInactive,
  getAllWorkTypesIncludingInactive,
  getAllCompensationRulesIncludingInactive,
  getAllPenaltyRulesIncludingInactive,
  getAllBonusRulesIncludingInactive,
} from "@/server/lookups/queries";
import {
  createPenaltyRuleAction,
  updatePenaltyRuleAction,
  createBonusRuleAction,
  updateBonusRuleAction,
} from "@/server/lookups/actions";
import { Forbidden } from "@/components/forbidden";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GeneralSettingsForm } from "./general-settings-form";
import { JobStatusesSection } from "./job-statuses-section";
import { WorkTypesSection } from "./work-types-section";
import { CompensationRulesSection } from "./compensation-rules-section";
import { SimpleRuleSection } from "./simple-rule-section";

export const metadata: Metadata = { title: "الإعدادات | نظام إدارة عمليات الزجاج" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_SETTINGS)) {
    return <Forbidden />;
  }

  const [settings, jobStatuses, workTypes, compensationRules, penaltyRules, bonusRules] =
    await Promise.all([
      getAllSettings(),
      getAllJobStatusesIncludingInactive(),
      getAllWorkTypesIncludingInactive(),
      getAllCompensationRulesIncludingInactive(),
      getAllPenaltyRulesIncludingInactive(),
      getAllBonusRulesIncludingInactive(),
    ]);

  // Compensation rules' "linked work type" dropdown needs every work type
  // (not just active ones) so an existing rule tied to a now-deactivated
  // work type still shows its real selection when its edit dialog opens.
  const workTypeOptions = workTypes.map((wt) => ({
    id: wt.id,
    labelAr: wt.isActive ? wt.labelAr : `${wt.labelAr} (معطّل)`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">
          إدارة القواعد المالية وبيانات الشركة وقوائم التصنيفات المستخدمة في النظام.
        </p>
      </div>

      <Tabs defaultValue="general" dir="rtl">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="general">عام</TabsTrigger>
          <TabsTrigger value="job-statuses">حالات المهام</TabsTrigger>
          <TabsTrigger value="work-types">أنواع العمل</TabsTrigger>
          <TabsTrigger value="compensation">قواعد التعويض</TabsTrigger>
          <TabsTrigger value="penalties">قواعد الجزاءات</TabsTrigger>
          <TabsTrigger value="bonuses">قواعد المكافآت</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSettingsForm settings={settings} />
        </TabsContent>

        <TabsContent value="job-statuses">
          <JobStatusesSection statuses={jobStatuses} />
        </TabsContent>

        <TabsContent value="work-types">
          <WorkTypesSection workTypes={workTypes} />
        </TabsContent>

        <TabsContent value="compensation">
          <CompensationRulesSection rules={compensationRules} workTypes={workTypeOptions} />
        </TabsContent>

        <TabsContent value="penalties">
          <SimpleRuleSection
            rules={penaltyRules}
            icon={TriangleAlert}
            title="قواعد الجزاءات"
            description="قواعد جاهزة يُختار منها عند تسجيل جزاء على فني. تعطيل قاعدة لا يغيّر أي جزاء سبق تسجيله."
            emptyTitle="لا توجد قواعد جزاءات"
            addTriggerLabel="إضافة قاعدة جزاء"
            addDialogTitle="إضافة قاعدة جزاء جديدة"
            editDialogTitle="تعديل قاعدة الجزاء"
            createAction={createPenaltyRuleAction}
            updateAction={updatePenaltyRuleAction}
          />
        </TabsContent>

        <TabsContent value="bonuses">
          <SimpleRuleSection
            rules={bonusRules}
            icon={Gift}
            title="قواعد المكافآت"
            description="قواعد جاهزة يُختار منها عند تسجيل مكافأة لفني. تعطيل قاعدة لا يغيّر أي مكافأة سبق تسجيلها."
            emptyTitle="لا توجد قواعد مكافآت"
            addTriggerLabel="إضافة قاعدة مكافأة"
            addDialogTitle="إضافة قاعدة مكافأة جديدة"
            editDialogTitle="تعديل قاعدة المكافأة"
            createAction={createBonusRuleAction}
            updateAction={updateBonusRuleAction}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

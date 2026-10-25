import { Check, Database, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/app/PageHeader";
import { SETTINGS_SECTION } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAiSpend } from "@/features/ai/queries";
import { formatCurrency } from "@/lib/format";
import { inDesktopApp } from "@/platform/runtime";
import { useDbStatus, useSettings, useUpdateSettings } from "./queries";
import { AI_MODELS, PRICE_PROVIDERS, SECRET_KEYS, secUserAgent, settingsSchema, type Settings } from "./schema";
import { SecretRow } from "./SecretRow";

/** Campo de texto que valida con Zod y guarda al salir del campo. */
function TextSetting<K extends "secUserAgentName" | "secUserAgentEmail">({
  id,
  field,
  settings,
  onSave,
  ...props
}: {
  id: string;
  field: K;
  settings: Settings;
  onSave: (patch: Partial<Settings>) => void;
  placeholder?: string;
  type?: string;
}) {
  const [draft, setDraft] = useState(settings[field]);
  const [error, setError] = useState<string>();
  useEffect(() => setDraft(settings[field]), [settings, field]);

  function commit() {
    const result = settingsSchema.shape[field].safeParse(draft);
    if (!result.success) return setError(result.error.issues[0]?.message ?? "Valor no válido");
    setError(undefined);
    if (result.data !== settings[field]) onSave({ [field]: result.data } as Partial<Settings>);
  }

  return (
    <>
      <Input
        id={id}
        value={draft}
        aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        {...props}
      />
      {error && (
        <p role="alert" className="mt-1 text-[12px] text-negative-text">
          {error}
        </p>
      )}
    </>
  );
}

function SavedIndicator({ at }: { at: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!at) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(t);
  }, [at]);
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-[12px] text-positive-text transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <Check className="size-3.5" aria-hidden /> Guardado
    </span>
  );
}

export function SettingsPage() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const db = useDbStatus();
  const { data: spend } = useAiSpend();
  const [savedAt, setSavedAt] = useState(0);

  if (!settings) return null;
  const save = (patch: Partial<Settings>) => update.mutate(patch, { onSuccess: () => setSavedAt(Date.now()) });
  const ua = secUserAgent(settings);

  return (
    <div className="mx-auto max-w-[1080px] px-10 pt-4 pb-12">
      <PageHeader title={SETTINGS_SECTION.title} subtitle={SETTINGS_SECTION.subtitle} actions={<SavedIndicator at={savedAt} />} />

      <div className="flex max-w-[860px] flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-4 text-accent" aria-hidden /> Claves de API
            </CardTitle>
            <CardDescription>
              Se guardan cifradas en el Llavero de macOS. La app nunca las muestra ni las escribe en registros.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {SECRET_KEYS.map((def) => (
              <SecretRow key={def.id} def={def} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identificación ante la SEC</CardTitle>
            <CardDescription>
              La SEC exige que cada consulta a EDGAR lleve tu nombre y email. Solo se envían a sec.gov.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Nombre" htmlFor="sec-name">
              <TextSetting id="sec-name" field="secUserAgentName" settings={settings} onSave={save} placeholder="Pablo García" />
            </Field>
            <Field
              label="Email"
              htmlFor="sec-email"
              hint={ua ? <>Se enviará: <span className="font-mono">{ua}</span></> : "Sin nombre y email no se podrá consultar EDGAR."}
            >
              <TextSetting id="sec-email" field="secUserAgentEmail" type="email" settings={settings} onSave={save} placeholder="tu@email.com" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inteligencia artificial</CardTitle>
            <CardDescription>
              La IA solo se usa al añadir un valor, cuando sale un informe nuevo, al pulsar «Re-analizar» o para leer un PDF.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Modelo para análisis" htmlFor="ai-analysis" hint={AI_MODELS.find((m) => m.id === settings.aiModelAnalysis)?.hint}>
              <Select id="ai-analysis" value={settings.aiModelAnalysis} onChange={(e) => save({ aiModelAnalysis: e.target.value as Settings["aiModelAnalysis"] })}>
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Modelo para extraer datos de PDFs" htmlFor="ai-extraction" hint={AI_MODELS.find((m) => m.id === settings.aiModelExtraction)?.hint}>
              <Select id="ai-extraction" value={settings.aiModelExtraction} onChange={(e) => save({ aiModelExtraction: e.target.value as Settings["aiModelExtraction"] })}>
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Presupuesto mensual"
              htmlFor="ai-budget"
              hint={`Si se supera, la app pedirá confirmación antes de cada llamada. Gastado este mes: ${spend ? `${spend.approx ? "≈ " : ""}${formatCurrency(spend.eur, "EUR", 2)} en ${spend.calls} llamada${spend.calls === 1 ? "" : "s"}` : "…"}.`}
            >
              <div className="relative">
                <Input
                  id="ai-budget"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={settings.aiMonthlyBudgetEur}
                  key={settings.aiMonthlyBudgetEur}
                  onBlur={(e) => {
                    const v = settingsSchema.shape.aiMonthlyBudgetEur.safeParse(Number(e.target.value));
                    if (v.success && v.data !== settings.aiMonthlyBudgetEur) save({ aiMonthlyBudgetEur: v.data });
                  }}
                  className="tabular pr-8"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted">€</span>
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datos de mercado</CardTitle>
            <CardDescription>Los precios se consultan una vez al abrir la app o al pulsar «Actualizar precios».</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Precios de EE. UU." htmlFor="price-provider" hint="Funcionan Tiingo (cuenta gratuita, acciones de EE. UU.) y Financial Modeling Prep (su plan gratis solo da unos pocos símbolos). El resto queda preparado para más adelante.">
              <Select
                id="price-provider"
                value={settings.priceProvider ?? ""}
                onChange={(e) => save({ priceProvider: (e.target.value || null) as Settings["priceProvider"] })}
              >
                <option value="">Sin elegir</option>
                {PRICE_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Precios de bolsas europeas" htmlFor="price-provider-eu" hint="Alpha Vantage (cuenta gratuita, 25 consultas al día): cubre París, Ámsterdam y otras bolsas, pero no Madrid. Cada acción gasta una consulta al actualizar precios y tres al añadirla o renovar su histórico (una vez al mes).">
              <Select
                id="price-provider-eu"
                value={settings.priceProviderEu ?? ""}
                onChange={(e) => save({ priceProviderEu: (e.target.value || null) as Settings["priceProviderEu"] })}
              >
                <option value="">Sin precios europeos</option>
                <option value="alphavantage">Alpha Vantage</option>
              </Select>
            </Field>
            <Field label="Divisa base" htmlFor="base-currency" hint="Toda la cartera se consolida en esta divisa con tipos del BCE.">
              <Select id="base-currency" value={settings.baseCurrency} onChange={(e) => save({ baseCurrency: e.target.value as Settings["baseCurrency"] })}>
                <option value="EUR">Euro (€)</option>
                <option value="USD">Dólar estadounidense (US$)</option>
              </Select>
            </Field>
            <Field label="Comprobar informes nuevos" htmlFor="check-frequency" hint="Consulta EDGAR y filings.xbrl.org en segundo plano.">
              <Select
                id="check-frequency"
                value={settings.reportCheckFrequency}
                onChange={(e) => save({ reportCheckFrequency: e.target.value as Settings["reportCheckFrequency"] })}
              >
                <option value="daily">Una vez al día</option>
                <option value="weekly">Una vez a la semana</option>
                <option value="manual">Solo cuando lo pida</option>
              </Select>
            </Field>
            <Field label="Cuando salga un informe nuevo" htmlFor="new-report-action" hint="Analizarlo usa la IA (con su coste). Si eliges preguntar, te avisa y tú decides desde el Calendario.">
              <Select id="new-report-action" value={settings.newReportAction} onChange={(e) => save({ newReportAction: e.target.value as Settings["newReportAction"] })}>
                <option value="ask">Avisarme y preguntar</option>
                <option value="auto">Analizarlo automáticamente</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aplicación</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Idioma" htmlFor="language">
              <Select id="language" value={settings.language} disabled>
                <option value="es">Español</option>
              </Select>
            </Field>
            <Field label="Apariencia" htmlFor="theme">
              <Select id="theme" value={settings.theme} onChange={(e) => save({ theme: e.target.value as Settings["theme"] })}>
                <option value="system">Como el sistema</option>
                <option value="light">Claro</option>
                <option value="dark">Oscuro</option>
              </Select>
            </Field>
            <Field label="Abrir al iniciar sesión" htmlFor="autostart" hint="La app arrancará en segundo plano para avisarte de informes nuevos.">
              <Switch id="autostart" checked={settings.autostart} onCheckedChange={(v) => save({ autostart: v })} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-accent" aria-hidden /> Almacenamiento local
            </CardTitle>
            <CardDescription>Todos tus datos se guardan solo en este Mac, en ~/Library/Application Support.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Base de datos">
              {db.data?.connected ? (
                <div className="flex flex-col items-start gap-1">
                  <Badge tone="positive"><Check aria-hidden /> Conectada</Badge>
                  <span className="text-[12px] text-muted">
                    Esquema v{db.data.schemaVersion} · {db.data.tables.length} tablas
                  </span>
                </div>
              ) : (
                <Badge tone={inDesktopApp ? "negative" : "warning"}>
                  {inDesktopApp ? `Error: ${db.data?.error ?? "desconocido"}` : "No disponible en la vista previa"}
                </Badge>
              )}
            </Field>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

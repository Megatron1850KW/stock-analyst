import { CheckCircle2, CircleDashed, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteSecret, useSaveSecret, useSecretExists } from "./queries";
import type { SECRET_KEYS } from "./schema";

type SecretDef = (typeof SECRET_KEYS)[number];

/** Una clave de API: se puede guardar, sustituir o borrar, pero nunca se muestra. */
export function SecretRow({ def }: { def: SecretDef }) {
  const exists = useSecretExists(def.id);
  const save = useSaveSecret(def.id);
  const remove = useDeleteSecret(def.id);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const inputId = `secret-${def.id}`;
  const showInput = editing || exists.data === false;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    await save.mutateAsync(value);
    setValue("");
    setEditing(false);
  }

  const error = save.error ?? remove.error ?? exists.error;

  return (
    <div className="border-t border-border py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <label htmlFor={inputId} className="text-[13px] font-medium">
                {def.label}
              </label>
              {!def.required && <span className="text-[11px] text-muted">opcional</span>}
            </div>
            <p className="mt-0.5 max-w-[52ch] text-[12px] leading-relaxed text-muted">{def.description}</p>
          </div>
        </div>
        {exists.data === true ? (
          <Badge tone="positive">
            <CheckCircle2 aria-hidden /> Guardada en el Llavero
          </Badge>
        ) : exists.data === false ? (
          <Badge tone="neutral">
            <CircleDashed aria-hidden /> Sin configurar
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 pl-7">
        {showInput ? (
          <form onSubmit={onSubmit} className="flex gap-2">
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Pega aquí la clave"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="max-w-[360px] font-mono placeholder:font-sans"
            />
            <Button type="submit" disabled={!value.trim() || save.isPending}>
              Guardar
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => (setEditing(false), setValue(""))}>
                Cancelar
              </Button>
            )}
          </form>
        ) : exists.data === true ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] tracking-widest text-muted" aria-label="Clave oculta">
              ••••••••••••
            </span>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Sustituir
            </Button>
            <Button variant="danger" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Eliminar
            </Button>
          </div>
        ) : null}
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-negative-text">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </div>
    </div>
  );
}

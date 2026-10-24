import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { countryName, SECTORS } from "@/domain/portfolio/sector";
import type { Holding } from "./load";
import { useSetClassification } from "./queries";

const COUNTRIES = ["ES", "US", "FR", "DE", "NL", "IT", "GB", "CH", "IE", "BE", "PT", "SE", "DK", "NO", "FI", "LU", "AT", "JP", "CN", "CA"];

/** Sector y país de una posición: para Europa no hay un dato oficial gratuito, así que lo indicas tú. */
export function ClassificationDialog({ h, onClose }: { h: Holding | null; onClose: () => void }) {
  const save = useSetClassification();
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  useEffect(() => {
    if (!h) return;
    setSector(h.position.security.sector ?? "");
    setCountry(h.position.security.country ?? "");
  }, [h]);
  const source =
    h?.sectorSource === "sic" ? "El sector actual sale del código SIC de la SEC; si lo cambias, manda el tuyo."
    : h?.sectorSource === "user" ? "Lo indicaste tú."
    : "No hay un dato oficial gratuito: indícalo tú para medir la concentración por sector (máximo 35 %).";
  return (
    <Dialog open={!!h} onClose={onClose} title={h ? `Sector y país de ${h.row.ticker}` : ""} description={source}>
      <div className="grid gap-3">
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Sector</span>
          <Select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Sin dato</option>
            {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">País</span>
          <Select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Sin dato</option>
            {[...new Set([...(country ? [country] : []), ...COUNTRIES])].map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </Select>
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button
          disabled={save.isPending || !h}
          onClick={() => h && save.mutate({ id: h.row.id, sector: sector || null, country: country || null }, { onSuccess: onClose })}
        >
          Guardar
        </Button>
      </div>
    </Dialog>
  );
}

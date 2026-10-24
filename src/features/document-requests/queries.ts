import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteUpload, resolveDocumentRequest } from "@/db/repo";
import { appDb } from "@/platform/database";
import { deleteDocumentFile, storeDocument } from "@/platform/documents";
import { registerUpload, type UploadForm } from "./upload";

function useInvalidate(securityId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["security", securityId] });
    void qc.invalidateQueries({ queryKey: ["watchlist"] });
  };
}

/** Guarda el archivo en el Mac y lo registra (cerrando la solicitud si la hay). */
export function useUploadDocument(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async ({ form, file }: { form: UploadForm; file: File }) => {
      const stored = await storeDocument(securityId, file);
      return registerUpload(await appDb(), form, file, stored);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteUpload(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async (filingId: number) => {
      const path = await deleteUpload(await appDb(), filingId);
      // El registro ya no existe; si el archivo no se pudiera borrar, no bloquea
      if (path) await deleteDocumentFile(path).catch(() => undefined);
    },
    onSuccess: invalidate,
  });
}

export function useDismissRequest(securityId: number) {
  const invalidate = useInvalidate(securityId);
  return useMutation({
    mutationFn: async (requestId: number) => resolveDocumentRequest(await appDb(), requestId, "dismissed"),
    onSuccess: invalidate,
  });
}

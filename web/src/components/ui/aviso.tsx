import type { ReactNode } from "react";

type Tom = "info" | "atencao" | "critico";

const estilos: Record<Tom, string> = {
  // Verde = realizacao, mostarda = atencao, vinho = critico (semantica do brandbook).
  info: "border-veri-verde/40 bg-veri-verde/10 text-veri-verde-escuro",
  atencao: "border-veri-mostarda/50 bg-veri-amarelo/15 text-veri-verde-escuro",
  critico: "border-veri-vinho/40 bg-veri-vinho/8 text-veri-vinho",
};

export function Aviso({
  tom = "info",
  titulo,
  children,
}: {
  tom?: Tom;
  titulo: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 text-sm ${estilos[tom]}`} role="note">
      <p className="font-semibold">{titulo}</p>
      {children && <div className="mt-2 space-y-2 leading-relaxed">{children}</div>}
    </div>
  );
}

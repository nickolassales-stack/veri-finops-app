import { ROTULO_SITUACAO, type SituacaoEtl } from "@/lib/diagnostico/etl";

/**
 * O estado do pipeline em uma peca.
 *
 * A COR NAO CARREGA O SIGNIFICADO SOZINHA -- o rotulo esta escrito por extenso
 * ao lado, e ha um simbolo com forma propria. Verde e vinho sao exatamente o
 * par que quem tem deuteranopia nao separa, e "OK" e "Erro" e a ultima
 * informacao desta tela que pode depender de enxergar diferenca de matiz.
 *
 * As cores seguem a semantica do brandbook: verde = realizacao, mostarda =
 * atencao, vinho = critico.
 */

const ESTILOS: Record<SituacaoEtl, { classe: string; simbolo: string }> = {
  ok: { classe: "border-veri-verde/50 bg-veri-verde/12 text-veri-verde-escuro", simbolo: "✓" },
  executando: {
    classe: "border-veri-verde-claro/60 bg-veri-verde-claro/12 text-veri-verde-escuro",
    simbolo: "◐",
  },
  atrasado: { classe: "border-veri-mostarda/60 bg-veri-amarelo/20 text-veri-verde-escuro", simbolo: "!" },
  erro: { classe: "border-veri-vinho/50 bg-veri-vinho/10 text-veri-vinho", simbolo: "✕" },
  nunca_executado: {
    classe: "border-veri-offwhite bg-veri-offwhite text-texto-suave",
    simbolo: "–",
  },
};

export function SeloSituacao({
  situacao,
  tamanho = "normal",
}: {
  situacao: SituacaoEtl;
  tamanho?: "normal" | "grande";
}) {
  const { classe, simbolo } = ESTILOS[situacao];

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border font-semibold",
        tamanho === "grande" ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm",
        classe,
      ].join(" ")}
    >
      <span aria-hidden className="veri-numero">
        {simbolo}
      </span>
      {ROTULO_SITUACAO[situacao]}
    </span>
  );
}

/** "8 s", "1 min 12 s", "—". */
export function formatDuracao(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos)) return "—";
  if (segundos < 60) return `${segundos} s`;
  const min = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto === 0 ? `${min} min` : `${min} min ${resto} s`;
}

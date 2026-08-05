export function SiteFooter() {
  return (
    <footer className="border-t border-veri-offwhite bg-veri-branco">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-6 py-6 text-xs text-veri-verde-escuro/70 sm:flex-row sm:items-center sm:justify-between">
        <p>VERI por Veridiana Quirino · Portal FinOps interno</p>
        <p>
          Origem dos dados: PostgreSQL FinOps, alimentado pelo ETL Athena → PostgreSQL.
          Valores em USD.
        </p>
      </div>
    </footer>
  );
}

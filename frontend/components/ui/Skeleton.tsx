// Skeleton de linhas de tabela — substitui o "Carregando..." em texto puro
// por barras pulsantes no formato das colunas reais, pra tela não "pular"
// quando os dados chegam.

export function TableSkeletonRows({ colunas, linhas = 5 }: { colunas: number; linhas?: number }) {
  return (
    <>
      {Array.from({ length: linhas }).map((_, i) => (
        <tr key={i} style={{ borderBottom: "1px solid #221D18" }}>
          {Array.from({ length: colunas }).map((_, j) => (
            <td key={j} className="px-5 py-3.5">
              <div
                className="h-3 rounded"
                style={{
                  background: "var(--cor-borda)",
                  width: j === 0 ? "70%" : `${45 + ((i + j) % 4) * 10}%`,
                  animation: "skeleton-pulse 1.4s ease-in-out infinite",
                  animationDelay: `${(i * 0.06).toFixed(2)}s`,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

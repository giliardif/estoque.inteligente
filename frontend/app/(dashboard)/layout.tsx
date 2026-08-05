"use client";

import { ReactNode, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme/useTheme";
import {
  LayoutGrid, Package, Boxes, ArrowLeftRight, ClipboardList, FileText,
  BarChart3, ShoppingCart, ShoppingBag, Bell, LogOut,
} from "lucide-react";

const nav = [
  { href: "/", label: "Painel", icon: LayoutGrid },
  { href: "/vendas", label: "Vendas / PDV", icon: ShoppingCart },
  { href: "/produtos", label: "Produtos", icon: Package },
  { href: "/estoque", label: "Estoque", icon: Boxes },
  { href: "/movimentacao", label: "Movimentação", icon: ArrowLeftRight },
  { href: "/inventario", label: "Inventário", icon: ClipboardList },
  { href: "/notas", label: "Notas Fiscais", icon: FileText },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const tema = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Proteção de rota no client: se não há usuário autenticado em memória,
    // volta pro login. A proteção REAL (que importa de verdade) é o backend
    // recusar qualquer chamada sem token válido — isto aqui é só UX.
    if (!usuario) router.replace("/login");
  }, [usuario, router]);

  if (!usuario) return null;

  return (
    <div className="flex min-h-screen">
      <aside
        className="w-60 shrink-0 border-r p-4 flex flex-col gap-5"
        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)" }}
      >
        <div className="flex items-center gap-2.5 px-1.5">
          {tema.logo_simbolo ? (
            <Image src={tema.logo_simbolo} alt={tema.logo_texto} width={26} height={32} priority />
          ) : null}
          <div className="leading-tight">
            <div className="font-display font-semibold text-sm">{tema.logo_texto}</div>
            {tema.logo_tagline ? (
              <div
                className="text-[9px] tracking-wide font-semibold"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                {tema.logo_tagline.toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => {
            const ativo = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors"
                style={
                  ativo
                    ? { color: "var(--cor-acento)", background: "color-mix(in srgb, var(--cor-acento) 12%, transparent)" }
                    : { color: "var(--cor-texto-muted)" }
                }
              >
                <item.icon size={16} strokeWidth={1.9} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={logout}
          className="mt-auto flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg hover:bg-white/5"
          style={{ color: "var(--cor-texto-muted)" }}
        >
          <LogOut size={14} /> Sair ({usuario.perfil})
        </button>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="px-7 py-6">{children}</div>
      </main>
    </div>
  );
}

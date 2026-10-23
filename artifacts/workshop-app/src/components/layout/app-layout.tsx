import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Wrench, Users, Bike, LayoutDashboard, Settings, LogOut, Menu, Briefcase, Plus, Building2, LifeBuoy, Package, TrendingUp, HardHat } from "lucide-react";
import { useExitPlatformWorkshop, useGetMe, useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useWorkers } from "@/hooks/use-workers";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { AccountDialog } from "@/components/account-dialog";

type NavItem = { href: string; label: string; icon: typeof Wrench };

const mainNavItems: NavItem[] = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/trabajos", label: "Trabajos", icon: Briefcase },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/inventario", label: "Inventario", icon: Package },
];

const adminNavItems: NavItem[] = [
  { href: "/admin/numeros", label: "Mis números", icon: TrendingUp },
  { href: "/admin/usuarios", label: "Equipo", icon: Users },
  { href: "/admin/catalogo", label: "Servicios y precios", icon: Wrench },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings },
];

const platformNavItems: NavItem[] = [
  { href: "/plataforma", label: "Talleres", icon: Building2 },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", mechanic: "Mecánico", reception: "Recepción", superadmin: "Superadmin",
};

// "/" solo está activo en la portada; el resto también en sus subpáginas (/trabajos/47).
const isActivePath = (location: string, href: string) =>
  href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const me = user;
  // Taller de una sola persona: sin "Mis trabajos" (es lo mismo que Trabajos).
  const { solo } = useWorkers();
  const logoutMutation = useLogout();
  const exitWorkshop = useExitPlatformWorkshop();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // El menú móvil se cierra al navegar.
  useEffect(() => { setMenuOpen(false); }, [location]);

  const isSuperadmin = user?.role === "superadmin";
  const inWorkshop = user?.workshopId != null;
  // El superadmin dentro de un taller trabaja como su administrador.
  const isAdmin = inWorkshop && (user?.role === "admin" || isSuperadmin);
  const roleLabel = user ? ROLE_LABELS[user.role] ?? user.role : "";

  const sections: { title: string; items: NavItem[] }[] = [
    ...(inWorkshop ? [{ title: "Operación", items: me?.doesJobs && !solo ? [{ href: "/mis-trabajos", label: "Mis trabajos", icon: HardHat }, ...mainNavItems] : mainNavItems }] : []),
    ...(isAdmin ? [{ title: "Administración", items: adminNavItems }] : []),
    ...(isSuperadmin ? [{ title: "Plataforma", items: platformNavItems }] : []),
  ];

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  // El superadmin sale del taller en que estaba dando soporte.
  const handleExitWorkshop = () => {
    exitWorkshop.mutate(undefined, {
      onSuccess: async () => {
        await queryClient.resetQueries();
        setLocation("/plataforma");
      },
    });
  };

  const NavLinks = ({ items }: { items: NavItem[] }) => (
    <ul className="space-y-1">
      {items.map((item) => {
        const isActive = isActivePath(location, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const Sections = () => (
    <>
      {sections.map(s => (
        <div key={s.title}>
          <h2 className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3 px-3">{s.title}</h2>
          <NavLinks items={s.items} />
        </div>
      ))}
    </>
  );

  const UserFooter = () => (
    <div className="flex items-center justify-between">
      <button type="button" onClick={() => { setMenuOpen(false); setAccountOpen(true); }} title="Mi cuenta" data-testid="button-my-account"
        className="flex flex-col min-w-0 text-left text-sidebar-foreground rounded-md px-1 -mx-1 hover:bg-sidebar-accent">
        <span className="text-sm font-medium truncate">{user?.name}</span>
        <span className="text-xs opacity-70">{roleLabel} · Mi cuenta</span>
      </button>
      <Button variant="ghost" size="icon" onClick={handleLogout} className="text-sidebar-foreground hover:bg-sidebar-accent" aria-label="Cerrar sesión">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );

  // Con logo: el logo y el nombre del taller. Sin logo: la marca de la app.
  const Brand = ({ size }: { size: "sm" | "lg" }) => (
    user?.workshopLogoUrl ? (
      <div className="flex items-center gap-2.5 min-w-0">
        <img src={user.workshopLogoUrl} alt="" className={`${size === "lg" ? "h-10 w-10" : "h-8 w-8"} rounded-md bg-white object-contain shrink-0`} />
        <p className="font-semibold text-sidebar-foreground truncate" data-testid="workshop-name">{user.workshopName}</p>
      </div>
    ) : (
      <div className="min-w-0">
        <h1 className={`${size === "lg" ? "text-xl" : "text-lg"} font-bold text-sidebar-primary flex items-center gap-2`}>
          <Wrench className={size === "lg" ? "h-6 w-6" : "h-5 w-5"} />
          TallerBicis
        </h1>
        {user?.workshopName && <p className="text-xs text-sidebar-foreground/70 truncate mt-0.5" data-testid="workshop-name">{user.workshopName}</p>}
      </div>
    )
  );

  // Barra inferior (móvil): Inicio, Trabajos, [Nuevo], Clientes y Más.
  const leftTabs: NavItem[] = [{ href: "/", label: "Inicio", icon: LayoutDashboard }, { href: "/trabajos", label: "Trabajos", icon: Briefcase }];
  const rightTabs: NavItem[] = [{ href: "/clientes", label: "Clientes", icon: Users }];
  const barHrefs = [...leftTabs, ...rightTabs].map(t => t.href);
  const moreActive = !barHrefs.some(h => isActivePath(location, h));
  const renderTab = (item: NavItem) => {
    const isActive = item.href === "/trabajos"
      ? isActivePath(location, item.href) && location !== "/trabajos/nuevo"
      : isActivePath(location, item.href);
    return (
      <Link key={item.href} href={item.href} className={`flex h-full flex-col items-center justify-center gap-1 ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground/70"}`}>
        <item.icon className="h-6 w-6" />
        <span className="text-[11px] font-medium leading-none">{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-dvh bg-background flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0">
        <div className="p-4 border-b border-sidebar-border"><Brand size="lg" /></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6"><Sections /></div>
        <div className="p-4 border-t border-sidebar-border"><UserFooter /></div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] bg-sidebar border-b border-sidebar-border">
        <Brand size="sm" />
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground" aria-label="Menú">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] max-w-sm bg-sidebar border-r-sidebar-border p-0 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="p-4 border-b border-sidebar-border"><Brand size="sm" /></div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6"><Sections /></div>
            <div className="p-4 border-t border-sidebar-border"><UserFooter /></div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Main Content */}
      <main className={`flex-1 min-w-0 overflow-x-hidden md:pb-0 ${inWorkshop ? "pb-[calc(4rem+env(safe-area-inset-bottom))]" : ""}`}>
        {isSuperadmin && inWorkshop && (
          <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 text-sm flex items-center gap-2" data-testid="support-banner">
            <LifeBuoy className="h-4 w-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate">Soporte: estás dentro de <strong>{user?.workshopName}</strong> como administrador.</span>
            <Button size="sm" variant="outline" className="h-7 bg-white" onClick={handleExitWorkshop} disabled={exitWorkshop.isPending}>Salir del taller</Button>
          </div>
        )}
        {children}
      </main>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />

      {/* Mobile Bottom Nav: solo dentro de un taller */}
      {inWorkshop && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-sidebar border-t border-sidebar-border grid grid-cols-5 items-center h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] z-50" data-testid="mobile-nav">
          {leftTabs.map(renderTab)}
          {/* "Nuevo trabajo": el botón principal, al centro y a la altura del pulgar. */}
          <Link href="/trabajos/nuevo" className="flex h-full flex-col items-center justify-center gap-1 text-sidebar-foreground" data-testid="mobile-nav-new">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"><Plus className="h-5 w-5" /></span>
            <span className="text-[11px] font-medium leading-none">Nuevo</span>
          </Link>
          {rightTabs.map(renderTab)}
          {/* "Más": lo que no cabe en la barra (inventario, números, equipo, configuración), a un pulgar de distancia. */}
          <button type="button" onClick={() => setMenuOpen(true)} data-testid="mobile-nav-more"
            className={`flex h-full flex-col items-center justify-center gap-1 ${moreActive ? "text-sidebar-primary" : "text-sidebar-foreground/70"}`}>
            <Menu className="h-6 w-6" />
            <span className="text-[11px] font-medium leading-none">Más</span>
          </button>
        </nav>
      )}
    </div>
  );
}

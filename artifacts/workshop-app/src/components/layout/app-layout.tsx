import { Link, useLocation } from "wouter";
import { 
  Wrench, 
  Users, 
  Bike, 
  LayoutDashboard, 
  FileText, 
  Calendar, 
  CreditCard,
  Settings,
  LogOut,
  Menu,
  ClipboardList,
  Inbox,
  Briefcase,
  Plus,
} from "lucide-react";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";

const mainNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trabajos", label: "Trabajos", icon: Briefcase },
  { href: "/presupuestos", label: "Presupuestos", icon: FileText },
  { href: "/recepciones", label: "Recepciones", icon: Inbox },
  { href: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { href: "/agenda", label: "Agenda", icon: Calendar },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/bicicletas", label: "Bicicletas", icon: Bike },
  { href: "/pagos", label: "Pagos", icon: CreditCard },
];

const adminNavItems = [
  { href: "/admin/usuarios", label: "Usuarios", icon: Users },
  { href: "/admin/servicios", label: "Servicios", icon: Wrench },
  { href: "/admin/repuestos", label: "Repuestos", icon: Settings },
  { href: "/admin/categorias", label: "Categorías", icon: Settings },
  { href: "/admin/metodos-pago", label: "Métodos de pago", icon: CreditCard },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const logoutMutation = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  const NavLinks = ({ items }: { items: typeof mainNavItems }) => (
    <ul className="space-y-1">
      {items.map((item) => {
        const isActive = location === item.href;
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

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0">
        <div className="p-4 border-b border-sidebar-border">
          <h1 className="text-xl font-bold text-sidebar-primary flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            TallerBicis
          </h1>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <h2 className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3 px-3">
              Operación
            </h2>
            <NavLinks items={mainNavItems} />
          </div>
          
          <div>
            <h2 className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3 px-3">
              Administración
            </h2>
            <NavLinks items={adminNavItems} />
          </div>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-sidebar-foreground">{user?.name}</span>
              <span className="text-xs text-sidebar-foreground/70 capitalize">{user?.role}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-sidebar-foreground hover:bg-sidebar-accent">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 bg-sidebar border-b border-sidebar-border">
        <h1 className="text-lg font-bold text-sidebar-primary flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          TallerBicis
        </h1>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[80vw] bg-sidebar border-r-sidebar-border p-0 flex flex-col">
            <div className="p-4 border-b border-sidebar-border">
              <h2 className="text-lg font-bold text-sidebar-primary">Menú</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <div>
                <h2 className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3 px-3">
                  Operación
                </h2>
                <NavLinks items={mainNavItems} />
              </div>
              <div>
                <h2 className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3 px-3">
                  Administración
                </h2>
                <NavLinks items={adminNavItems} />
              </div>
            </div>
            <div className="p-4 border-t border-sidebar-border flex items-center justify-between">
              <div className="flex flex-col text-sidebar-foreground">
                <span className="text-sm font-medium">{user?.name}</span>
                <span className="text-xs opacity-70 capitalize">{user?.role}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={handleLogout} className="text-sidebar-foreground">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-sidebar border-t border-sidebar-border flex items-center justify-around p-2 z-50">
        {[
          { href: "/", icon: LayoutDashboard, label: "Inicio" },
          { href: "/trabajos", icon: Briefcase, label: "Trabajos" },
          { href: "/trabajos/nuevo", icon: Plus, label: "Nuevo" },
          { href: "/clientes", icon: Users, label: "Clientes" },
        ].map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className={`flex flex-col items-center p-2 rounded-lg ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground/70"}`}>
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] mt-1 font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

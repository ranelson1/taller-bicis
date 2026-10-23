import { Switch, Route, Router as WouterRouter, Redirect, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetMe, useGetWorkOrder } from "@workspace/api-client-react";

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Bicycles from "@/pages/bicycles";
import Users from "@/pages/admin/users";
import ServiceDetail from "@/pages/admin/service-detail";
import Catalog from "@/pages/admin/catalog";
import Settings from "@/pages/admin/settings";
import PresupuestoDetail from "@/pages/presupuesto-detail";
import RecepcionNueva from "@/pages/recepcion-nueva";
import RecepcionDetail from "@/pages/recepcion-detail";
import Trabajos from "@/pages/trabajos";
import TrabajoNuevo from "@/pages/trabajo-nuevo";
import TrabajoDetail from "@/pages/trabajo-detail";
import OtPublica from "@/pages/ot-publica";
import Platform from "@/pages/platform";
import Inventario from "@/pages/inventario";
import CompraDetail from "@/pages/compra-detail";
import MisNumeros from "@/pages/mis-numeros";
import MisTrabajos from "@/pages/mis-trabajos";
import BicicletaDetail from "@/pages/bicicleta-detail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe({
    request: { credentials: "include" },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // El superadmin sin taller elegido solo tiene el panel de la plataforma.
  if (user.role === "superadmin" && user.workshopId == null) {
    return <Redirect to="/plataforma" />;
  }

  return <AppLayout>{children}</AppLayout>;
}

// Páginas de administración del taller: admin (o el superadmin dentro de un taller).
function AdminGate({ children }: { children: React.ReactNode }) {
  const { data: user } = useGetMe({ request: { credentials: "include" } });
  if (user && user.role !== "admin" && user.role !== "superadmin") return <Redirect to="/" />;
  return <AuthGate>{children}</AuthGate>;
}

// Panel de la plataforma: solo superadmin.
function SuperadminGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe({ request: { credentials: "include" } });
  if (isLoading) return null;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "superadmin") return <Redirect to="/" />;
  return <AppLayout>{children}</AppLayout>;
}

// Las OT se ven dentro de su trabajo: /ordenes/:id lleva a /trabajos/:workCaseId.
function OrdenRedirect() {
  const { id } = useParams<{ id: string }>();
  const { data: wo, isError } = useGetWorkOrder(Number(id));
  if (isError) return <Redirect to="/trabajos" />;
  if (!wo) return null;
  return <Redirect to={wo.workCaseId ? `/trabajos/${wo.workCaseId}` : "/trabajos"} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      {/* Vista pública del cliente: sin login, por token secreto */}
      <Route path="/ot/:token" component={OtPublica} />

      <Route path="/plataforma">
        <SuperadminGate><Platform /></SuperadminGate>
      </Route>

      <Route path="/">
        <AuthGate><Dashboard /></AuthGate>
      </Route>
      <Route path="/clientes">
        <AuthGate><Clients /></AuthGate>
      </Route>
      <Route path="/clientes/:id">
        <AuthGate><ClientDetail /></AuthGate>
      </Route>
      <Route path="/bicicletas">
        <AuthGate><Bicycles /></AuthGate>
      </Route>
      <Route path="/bicicletas/:id">
        <AuthGate><BicicletaDetail /></AuthGate>
      </Route>

      <Route path="/mis-trabajos">
        <AuthGate><MisTrabajos /></AuthGate>
      </Route>
      <Route path="/inventario">
        <AuthGate><Inventario /></AuthGate>
      </Route>
      <Route path="/inventario/compras/:id">
        <AuthGate><CompraDetail /></AuthGate>
      </Route>

      {/* Admin */}
      <Route path="/admin/numeros">
        <AdminGate><MisNumeros /></AdminGate>
      </Route>
      <Route path="/admin/usuarios">
        <AdminGate><Users /></AdminGate>
      </Route>
      <Route path="/admin/catalogo">
        <AdminGate><Catalog /></AdminGate>
      </Route>
      <Route path="/admin/servicios/:id">
        <AdminGate><ServiceDetail /></AdminGate>
      </Route>
      <Route path="/admin/configuracion">
        <AdminGate><Settings /></AdminGate>
      </Route>
      {/* Rutas anteriores del catálogo y la configuración */}
      <Route path="/admin/servicios"><Redirect to="/admin/catalogo?tab=servicios" /></Route>
      <Route path="/admin/repuestos"><Redirect to="/inventario" /></Route>
      <Route path="/admin/categorias"><Redirect to="/admin/catalogo?tab=categorias" /></Route>
      <Route path="/admin/metodos-pago"><Redirect to="/admin/configuracion" /></Route>

      {/* Presupuesto y recepción ya no son documentos aparte: todo vive en el trabajo.
          Sus fichas quedan solo para trabajos antiguos que aún no tienen OT. */}
      <Route path="/presupuestos"><Redirect to="/trabajos" /></Route>
      <Route path="/presupuestos/nuevo"><Redirect to="/trabajos/nuevo" /></Route>
      <Route path="/presupuestos/:id">
        <AuthGate><PresupuestoDetail /></AuthGate>
      </Route>
      <Route path="/recepciones"><Redirect to="/trabajos" /></Route>
      <Route path="/recepciones/nueva">
        <AuthGate><RecepcionNueva /></AuthGate>
      </Route>
      <Route path="/recepciones/:id">
        <AuthGate><RecepcionDetail /></AuthGate>
      </Route>
      <Route path="/ordenes"><Redirect to="/trabajos" /></Route>
      <Route path="/ordenes/:id">
        <AuthGate><OrdenRedirect /></AuthGate>
      </Route>
      <Route path="/trabajos">
        <AuthGate><Trabajos /></AuthGate>
      </Route>
      <Route path="/trabajos/nuevo">
        <AuthGate><TrabajoNuevo /></AuthGate>
      </Route>
      <Route path="/trabajos/:id">
        <AuthGate><TrabajoDetail /></AuthGate>
      </Route>
      <Route path="/agenda"><Redirect to="/" /></Route>
      <Route path="/pagos"><Redirect to="/" /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

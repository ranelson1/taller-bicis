import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetMe } from "@workspace/api-client-react";

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Bicycles from "@/pages/bicycles";
import Users from "@/pages/admin/users";
import Services from "@/pages/admin/services";
import ServiceDetail from "@/pages/admin/service-detail";
import Parts from "@/pages/admin/parts";
import Categories from "@/pages/admin/categories";
import PaymentMethods from "@/pages/admin/payment-methods";
import Presupuestos from "@/pages/presupuestos";
import PresupuestoNuevo from "@/pages/presupuesto-nuevo";
import PresupuestoDetail from "@/pages/presupuesto-detail";
import PlaceholderPage from "@/pages/placeholder";
import Recepciones from "@/pages/recepciones";
import RecepcionNueva from "@/pages/recepcion-nueva";
import RecepcionDetail from "@/pages/recepcion-detail";
import Ordenes from "@/pages/ordenes";
import OrdenDetail from "@/pages/orden-detail";
import Trabajos from "@/pages/trabajos";
import TrabajoNuevo from "@/pages/trabajo-nuevo";
import TrabajoDetail from "@/pages/trabajo-detail";
import OtPublica from "@/pages/ot-publica";

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

  return <AppLayout>{children}</AppLayout>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      {/* Vista pública del cliente: sin login, por token secreto */}
      <Route path="/ot/:token" component={OtPublica} />

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

      {/* Admin */}
      <Route path="/admin/usuarios">
        <AuthGate><Users /></AuthGate>
      </Route>
      <Route path="/admin/servicios">
        <AuthGate><Services /></AuthGate>
      </Route>
      <Route path="/admin/servicios/:id">
        <AuthGate><ServiceDetail /></AuthGate>
      </Route>
      <Route path="/admin/repuestos">
        <AuthGate><Parts /></AuthGate>
      </Route>
      <Route path="/admin/categorias">
        <AuthGate><Categories /></AuthGate>
      </Route>
      <Route path="/admin/metodos-pago">
        <AuthGate><PaymentMethods /></AuthGate>
      </Route>

      {/* Presupuestos */}
      <Route path="/presupuestos">
        <AuthGate><Presupuestos /></AuthGate>
      </Route>
      <Route path="/presupuestos/nuevo">
        <AuthGate><PresupuestoNuevo /></AuthGate>
      </Route>
      <Route path="/presupuestos/:id">
        <AuthGate><PresupuestoDetail /></AuthGate>
      </Route>
      <Route path="/recepciones">
        <AuthGate><Recepciones /></AuthGate>
      </Route>
      <Route path="/recepciones/nueva">
        <AuthGate><RecepcionNueva /></AuthGate>
      </Route>
      <Route path="/recepciones/:id">
        <AuthGate><RecepcionDetail /></AuthGate>
      </Route>
      <Route path="/ordenes">
        <AuthGate><Ordenes /></AuthGate>
      </Route>
      <Route path="/ordenes/:id">
        <AuthGate><OrdenDetail /></AuthGate>
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
      <Route path="/agenda">
        <AuthGate><PlaceholderPage title="Agenda" description="Calendario de turnos y entregas." /></AuthGate>
      </Route>
      <Route path="/pagos">
        <AuthGate><PlaceholderPage title="Pagos" description="Registro de pagos y facturación." /></AuthGate>
      </Route>

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

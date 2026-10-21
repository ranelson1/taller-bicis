import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLogin, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const loginMutation = useLogin();
  const { data: user, isLoading } = useGetMe({
    request: { credentials: "include" }
  });

  useEffect(() => {
    if (user && !isLoading) {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({
            title: "Inicio de sesión exitoso",
            description: "Bienvenido al sistema.",
          });
          setLocation("/");
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Credenciales incorrectas.",
          });
        },
      }
    );
  };

  if (isLoading || user) {
    return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-md shadow-lg border-zinc-200">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto w-12 h-12 bg-primary text-primary-foreground rounded-xl flex items-center justify-center mb-4">
            <Wrench className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold">Taller de Bicicletas</CardTitle>
          <CardDescription>Ingresa al sistema de gestión</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo electrónico</FormLabel>
                    <FormControl>
                      <Input placeholder="taller@ejemplo.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contraseña</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? "Ingresando..." : "Ingresar"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

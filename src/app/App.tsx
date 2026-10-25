import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ProtectedRoute, PublicOnlyRoute, RequireAccess } from '@/features/auth/ProtectedRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { AppLayout } from '@/layouts/AppLayout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { SupermarketsPage } from '@/features/supermarkets/SupermarketsPage';
import { PlatformReportsPage } from '@/features/reports/PlatformReportsPage';
import { AuditLogsPage } from '@/features/audit/AuditLogsPage';
import { PosPage } from '@/features/pos/PosPage';
import { SalesHistoryPage } from '@/features/sales/SalesHistoryPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { CategoriesPage } from '@/features/products/CategoriesPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { ReceivingPage } from '@/features/inventory/ReceivingPage';
import { SuppliersPage } from '@/features/suppliers/SuppliersPage';
import { PurchasesPage } from '@/features/purchasing/PurchasesPage';
import { LabelsPage } from '@/features/labels/LabelsPage';
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { ShiftsPage } from '@/features/shifts/ShiftsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

const guarded = [
  ['/supermarkets', <SupermarketsPage />], ['/platform-reports', <PlatformReportsPage />], ['/audit', <AuditLogsPage />], ['/pos', <PosPage />],
  ['/sales', <SalesHistoryPage />], ['/products', <ProductsPage />], ['/categories', <CategoriesPage />], ['/inventory', <InventoryPage />],
  ['/receiving', <ReceivingPage />], ['/suppliers', <SuppliersPage />], ['/purchases', <PurchasesPage />], ['/labels', <LabelsPage />],
  ['/expenses', <ExpensesPage />], ['/shifts', <ShiftsPage />], ['/reports', <ReportsPage />], ['/employees', <EmployeesPage />], ['/settings', <SettingsPage />],
] as const;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                {guarded.map(([path, el]) => <Route key={path} path={path.slice(1)} element={<RequireAccess path={path}>{el}</RequireAccess>} />)}
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

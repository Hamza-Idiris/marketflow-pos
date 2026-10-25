export type Role = 'admin' | 'stock_staff' | 'cashier';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  is_super_admin: boolean;
  is_active: boolean;
}

export interface StoreSummary {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Membership {
  id: string;
  supermarket_id: string;
  role: Role;
  cashier_max_discount_pct: number;
  supermarket: StoreSummary;
}

export type Currency = 'USD' | 'SOS';
export type PaymentMethod = 'cash' | 'evc_plus' | 'sahal' | 'zaad';

export interface Category { id: string; name: string; is_active: boolean }
export interface Unit { id: string; name: string; abbreviation: string }
export interface Product {
  id: string; supermarket_id: string; category_id: string | null; unit_id: string | null; name: string;
  sku: string | null; barcode: string | null; image_path: string | null; min_stock: number;
  track_expiry: boolean; is_active: boolean;
}
export interface Supplier { id: string; name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; is_active: boolean }
export interface PosProduct {
  product_id: string; name: string; sku: string | null; barcode: string | null; category_id: string | null;
  image_path: string | null; usd_price: number | null; sos_price: number | null; available: number; min_stock: number;
}
export interface ReceiptData {
  sale: { id: string; receipt_number: string; currency: Currency; subtotal: number; discount_total: number; total: number; status: string; created_at: string };
  store: { name: string; phone: string | null; email: string | null; address: string | null; footer: string };
  cashier: string;
  items: Array<{ name: string; quantity: number; unit_price: number; discount_pct: number; discount_amount: number; line_total: number }>;
  payments: Array<{ method: PaymentMethod; amount: number; currency: Currency; exchange_rate: number | null; converted_amount: number; reference: string | null; verification: string }>;
  print_count: number;
}

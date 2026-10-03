export type UserRole = "STUDENT" | "RUNNER" | "ADMIN";

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_CONFIRMED"
  | "FINDING_RUNNER"
  | "RUNNER_ASSIGNED"
  | "SOURCING_PRODUCT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUND_PROCESSING"
  | "REFUNDED"
  | "FAILED";

export type PaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "REFUNDED";

export type ProductStatus = "ACTIVE" | "INACTIVE";

export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  price: number;
  category: string;
  status: ProductStatus;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export interface DeliveryLocation {
  id: string;
  label: string;
  address: string;
  instructions?: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryLocation: DeliveryLocation;
  createdAt: Date;
}
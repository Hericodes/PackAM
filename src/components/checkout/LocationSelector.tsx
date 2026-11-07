/**
 * The delivery-location shape shared by checkout, printing and the location form.
 *
 * The old "pick a saved location" chooser lived here. Delivery now always starts from the phone's live
 * location (CheckoutLocationStep), so saved locations are no longer offered for reuse.
 */
export type DeliveryLocation = {
  id: string;
  label: string;
  address: string;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
};

export const hasPin = (location: DeliveryLocation) => location.latitude !== null && location.longitude !== null;

export type Spot = { address: string; city: string | null; lat: number; lng: number };

export type DriverTrip = {
  id: string; tripCode: string; status: string; exception: string | null; bookingCode: string; product: string; quantityKl: number;
  loadingDate: string; loadingTime: string; expectedDeliveryDate: string; pickup: Spot; delivery: Spot;
  tanker: { registrationNumber: string; capacityKl: number } | null;
  loadingContact: { name: string; phone: string }; deliveryContact: { name: string; phone: string };
  loadingInstructions: string | null; deliveryInstructions: string | null;
  nextAction: string | null; locationSharingAllowed: boolean; lastGpsAt: string | null;
};

export const ACTION_LABEL: Record<string, string> = {
  CONFIRM_ASSIGNMENT: 'Confirm assignment', REACHED_PICKUP: 'Reached pickup', START_LOADING: 'Start loading', COMPLETE_LOADING: 'Complete loading',
  START_TRIP: 'Start trip', REACHED_DELIVERY: 'Reached delivery', START_UNLOADING: 'Start unloading', COMPLETE_UNLOADING: 'Complete unloading', SUBMIT_COMPLETION: 'Submit trip completion',
};

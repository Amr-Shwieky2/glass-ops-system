import { Fuel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddFuelDialog } from "../vehicles/add-fuel-dialog";

/**
 * My Day's "Add Fuel" quick action (sections 56/60) — a single prominent
 * button opening the exact same dialog used on the vehicle detail page,
 * per the phase brief ("don't build it twice"). Vehicle defaults to the
 * technician's users.defaultVehicleId when set; they can still switch it
 * from the dialog's own Vehicle field if they're fueling something else.
 */
export function AddFuelQuickAction({
  vehicles,
  defaultVehicleId,
}: {
  vehicles: { id: string; name: string; plateNumber: string }[];
  defaultVehicleId: string | null;
}) {
  return (
    <AddFuelDialog
      vehicles={vehicles}
      defaultVehicleId={defaultVehicleId}
      trigger={
        <Button size="lg" className="w-full">
          <Fuel className="size-4" />
          إضافة وقود
        </Button>
      }
    />
  );
}

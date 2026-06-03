"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  data: any;
  setData: (v: any) => void;
  onClose: () => void;
  onApply: () => void;
  error?: string;
};

export default function AdjustBalanceDialog({
  open,
  data,
  setData,
  onClose,
  onApply,
  error,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Adjust Balance — {data?.login}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <select
            className="rounded-md border px-2 py-1.5 text-sm"
            value={data?.type || "DEPOSIT"}
            onChange={(e) =>
              setData({ ...data, type: e.target.value })
            }
          >
            <option value="DEPOSIT">Deposit</option>
            <option value="WITHDRAWAL">Withdrawal</option>
            <option value="CREDIT_IN">Credit In</option>
            <option value="CREDIT_OUT">Credit Out</option>
            <option value="BONUS">Bonus</option>
          </select>

          <Input
            type="number"
            placeholder="Amount"
            value={data?.amount || ""}
            onChange={(e) =>
              setData({ ...data, amount: e.target.value })
            }
          />

          <Input
            placeholder="Description (optional)"
            value={data?.description || ""}
            onChange={(e) =>
              setData({ ...data, description: e.target.value })
            }
          />

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>

          <Button variant="cubex" onClick={onApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
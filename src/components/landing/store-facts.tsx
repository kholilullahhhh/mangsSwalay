import Link from "next/link";
import { Clock, Mail, MapPin, Phone, ShoppingBasket } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Store facts strip.
 *
 * The one place a visitor can answer "can I go there, when is it open, how do I
 * contact them" without scrolling. Hours are listed first because a store's
 * opening time is the fact people check most and the one most likely to send them
 * to the wrong place.
 *
 * Every item is conditional: a store that has not entered its address yet renders
 * a shorter strip rather than a row of empty fields.
 */
export function StoreFacts({
  address,
  hours,
  phone,
  whatsapp,
  email,
}: {
  address: string;
  hours: string | null;
  phone: string;
  whatsapp: string;
  email: string;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 border-t pt-6 sm:grid-cols-2">
      {hours ? (
        <div className="flex items-start gap-3">
          <Clock
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <dt className="text-sm font-medium">Jam buka</dt>
            <dd className="text-sm text-muted-foreground">{hours}</dd>
          </div>
        </div>
      ) : null}

      {address ? (
        <div className="flex items-start gap-3">
          <MapPin
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <dt className="text-sm font-medium">Alamat</dt>
            <dd className="text-sm text-muted-foreground">{address}</dd>
          </div>
        </div>
      ) : null}

      {phone ? (
        <div className="flex items-start gap-3">
          <Phone
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <dt className="text-sm font-medium">Telepon</dt>
            <dd>
              <a
                href={`tel:${phone.replace(/\D/g, "")}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {phone}
              </a>
            </dd>
          </div>
        </div>
      ) : null}

      {whatsapp ? (
        <div className="flex items-start gap-3">
          <ShoppingBasket
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <dt className="text-sm font-medium">WhatsApp</dt>
            <dd>
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Chat WhatsApp
              </a>
            </dd>
          </div>
        </div>
      ) : null}

      {email ? (
        <div className="flex items-start gap-3">
          <Mail
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <dt className="text-sm font-medium">Email</dt>
            <dd>
              <a
                href={`mailto:${email}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {email}
              </a>
            </dd>
          </div>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * Staff sign-in call to action.
 *
 * One action, for the only other thing a visitor can do here. A "learn more"
 * link to a page that does not exist would be worse than no link.
 */
export function StaffEntry({ storeName }: { storeName: string }) {
  return (
    <div className="border-t pt-6">
      <p className="text-sm text-muted-foreground">
        Staf {storeName} masuk lewat halaman ini.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link href="/login">Masuk sebagai staf</Link>
      </Button>
    </div>
  );
}
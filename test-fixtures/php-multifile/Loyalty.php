<?php

namespace Bodega;

class Loyalty
{
    public function pointsFor(int $subtotal): int
    {
        return intdiv($subtotal, 100);
    }
}

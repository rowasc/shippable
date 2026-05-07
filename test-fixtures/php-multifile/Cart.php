<?php

namespace Bodega;

class Cart
{
    public array $items = [];

    public function add(string $sku, int $qty): void
    {
        $this->items[$sku] = ($this->items[$sku] ?? 0) + $qty;
    }

    public function subtotal(): int
    {
        $total = 0;
        foreach ($this->items as $qty) {
            $total += 100 * $qty;
        }
        return $total;
    }
}

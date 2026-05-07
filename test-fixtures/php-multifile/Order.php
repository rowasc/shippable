<?php

namespace Bodega;

class Order
{
    public function __construct(
        public string $id,
        public Cart $cart,
        public int $total,
    ) {}
}

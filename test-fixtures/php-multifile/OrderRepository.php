<?php

namespace Bodega;

class OrderRepository
{
    private array $byId = [];

    public function save(Order $order): void
    {
        $this->byId[$order->id] = $order;
    }

    public function find(string $id): ?Order
    {
        return $this->byId[$id] ?? null;
    }
}

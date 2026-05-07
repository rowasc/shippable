<?php

namespace Bodega;

class PaymentGateway
{
    public function charge(int $amount): bool
    {
        return $amount > 0;
    }
}

<?php

namespace Bodega;

class Routes
{
    private Cart $cart;
    private OrderRepository $orders;
    private Loyalty $loyalty;
    private PaymentGateway $gateway;

    public function __construct()
    {
        $this->cart = new Cart();
        $this->orders = new OrderRepository();
        $this->loyalty = new Loyalty();
        $this->gateway = new PaymentGateway();
    }

    public function checkout(string $orderId): bool
    {
        $subtotal = $this->cart->subtotal();
        if (!$this->gateway->charge($subtotal)) {
            return false;
        }
        $order = new Order($orderId, $this->cart, $subtotal);
        $this->orders->save($order);
        $this->loyalty->pointsFor($subtotal);
        return true;
    }
}

<?php

namespace App\Traits;

trait HasTimestamps
{
    public function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}

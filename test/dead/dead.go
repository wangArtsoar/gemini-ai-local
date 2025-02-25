package main

import (
	"math/big"
	"sync"
)

// computePisanoPeriod calculates the Pisano period for Fibonacci modulo m.
func computePisanoPeriod(m *big.Int) int64 {
	zero := big.NewInt(0)
	one := big.NewInt(1)

	prev := big.NewInt(0)
	curr := big.NewInt(1)

	for i := int64(0); ; i++ {
		// Calculate the next Fibonacci number mod m
		next := new(big.Int).Add(prev, curr)
		next.Mod(next, m)

		// Update prev and curr
		prev.Set(curr)
		curr.Set(next)

		// Check for cycle start (0, 1)
		if prev.Cmp(zero) == 0 && curr.Cmp(one) == 0 {
			return i + 1
		}
	}
}

// concurrentPisanoPeriod calculates Pisano periods concurrently for a slice of modulo values.
func concurrentPisanoPeriod(modulos []*big.Int) map[string]int64 {
	results := make(map[string]int64)
	var wg sync.WaitGroup
	mu := &sync.Mutex{}

	worker := func(mod *big.Int) {
		defer wg.Done()
		period := computePisanoPeriod(mod)

		mu.Lock()
		results[mod.String()] = period
		mu.Unlock()
	}

	for _, mod := range modulos {
		wg.Add(1)
		go worker(mod)
	}

	wg.Wait()
	return results
}

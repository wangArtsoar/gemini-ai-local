package main

import (
	"fmt"
	"sort"
)

func CalculateProductDifference(nums []int, result chan<- int) {
	sort.Ints(nums)
	n := len(nums)
	maxProduct := nums[n-1] * nums[n-2] * nums[n-3]
	minProduct := nums[0] * nums[1] * nums[2]
	diff := maxProduct - minProduct
	result <- diff
}

func main() {
	nums := []int{1, 2, 3, 4, 5}
	result := make(chan int)
	go CalculateProductDifference(nums, result)
	total := <-result
	fmt.Println("Total sum:", total)
}
